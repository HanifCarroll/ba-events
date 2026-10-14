#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { AI_BASE_URL, AI_MODEL } from '#shared/lib/ai/constants.ts'
import { eventFacetsSchema } from '#shared/lib/search-facets.ts'
import { printReport, type CaseResult } from '../lib/report.ts'
import { ENRICHMENT_CASES, ENRICHMENT_CORPUS_VERSION, scoreEnrichmentCase, type EnrichmentCase } from './suite.ts'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const responseSchemas: Record<'summary' | 'venue' | 'missing' | 'facets', z.ZodType> = {
  summary: z.object({ summary: z.string() }), venue: z.object({ venue_name: z.string().nullable() }),
  missing: z.object({ description: z.string() }), facets: eventFacetsSchema,
}

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Explicit model evaluation required: bun run eval:enrichment --live')
  const taskIndex = process.argv.indexOf('--task')
  const selectedTask = taskIndex >= 0 ? process.argv[taskIndex + 1] : undefined
  if (taskIndex >= 0 && !ENRICHMENT_CASES.some(test => test.task === selectedTask)) throw new Error('Unknown enrichment task')
  const cases = selectedTask ? ENRICHMENT_CASES.filter(test => test.task === selectedTask) : ENRICHMENT_CASES
  if (!process.env.AI_API_KEY && !process.env.DEEPSEEK_API_KEY && !process.env.ANTHROPIC_API_KEY) throw new Error('A model key is required')
  const sourceHashes: Record<string,string> = {}
  for (const path of ['src/shared/lib/ai/enrichment.ts','src/shared/lib/ai/extract-facets.ts','src/shared/lib/ai/providers.ts','evals/enrichment/suite.ts','evals/enrichment/run.ts']) sourceHashes[path] = hash(await readFile(path, 'utf8'))
  const originalFetch = globalThis.fetch
  const originalError = console.error
  const allowedOrigin = new URL(AI_BASE_URL).origin
  let active: { test: EnrichmentCase; attempts: Array<{ status: number; valid: boolean; body: string }>; errors: number } | undefined
  globalThis.fetch = (async (url, init) => {
    const target = new URL(url instanceof Request ? url.url : String(url))
    if (!active || target.origin !== allowedOrigin) throw new Error('Enrichment controls prohibit source/database fetches')
    const request = JSON.parse(url instanceof Request ? await url.clone().text() : String(init?.body))
    if (!JSON.stringify(request.messages).includes(JSON.stringify(active.test.source).slice(1,-1))) {
      // JSON escaping is used only to verify delivery, not to grade semantic output.
      throw new Error('Source control did not reach the actual model request')
    }
    const response = await originalFetch(url, init)
    const body = await response.clone().text()
    let valid = false
    try {
      const envelope = JSON.parse(body)
      const choice = envelope.choices?.[0]
      const content = choice?.message?.content
      if (response.ok && choice?.finish_reason === 'stop' && typeof content === 'string') {
        valid = active.test.task === 'translation' ? Boolean(content.trim())
          : responseSchemas[active.test.task].safeParse(JSON.parse(content)).success
      }
    } catch { /* The invalid response stays an execution error. */ }
    active.attempts.push({ status: response.status, valid, body })
    return response
  }) as typeof fetch
  console.error = (...values) => { if (active) active.errors++; originalError(...values) }
  const results: Array<CaseResult & { task: string; output?: unknown; attempts: unknown[]; executionErrors: number }> = []
  try {
    // Import after installing the transport observer; use the production helpers unchanged.
    const { translateText, generateDescriptionSummary, extractDescription, extractVenueName } = await import('#shared/lib/ai/enrichment.ts')
    const { extractEventFacets, eventFacetsModelSchema } = await import('#shared/lib/ai/extract-facets.ts')
    responseSchemas.facets = eventFacetsModelSchema
    for (const test of cases) {
      active = { test, attempts: [], errors: 0 }
      let output: unknown
      let failures: string[] = []
      try {
        const language = test.locale === 'es' ? 'spanish' : 'english'
        output = test.task === 'translation' ? await translateText(test.source, test.locale === 'en' ? 'es-to-en' : 'en-to-es')
          : test.task === 'summary' ? await generateDescriptionSummary(test.source, language)
          : test.task === 'venue' ? await extractVenueName(test.source)
          : test.task === 'missing' ? await extractDescription(test.source, language)
          : await extractEventFacets({ name: 'Controlled event', [test.locale === 'es' ? 'description_es' : 'description_en']: test.source })
        failures = scoreEnrichmentCase(test, output)
      } catch { active.errors++; failures.push('production helper failed') }
      const executionErrors = active.errors + active.attempts.filter(attempt => !attempt.valid).length
      if (!active.attempts.length || executionErrors) failures.push('missing or invalid model execution')
      if (test.task === 'facets' && output && typeof output === 'object' && !Object.keys(output).length) failures.push('facet failure fallback returned')
      results.push({ id: test.id, task: test.task, pass: !failures.length, failures, output, attempts: active.attempts, executionErrors })
    }
  } finally { globalThis.fetch = originalFetch; console.error = originalError; active = undefined }
  const receipt = { metadata: { version: ENRICHMENT_CORPUS_VERSION, corpusHash: hash(JSON.stringify(ENRICHMENT_CASES)),
    selectedCaseIds: cases.map(test => test.id),
    model: AI_MODEL, origin: 'developer_authored_source_controls', graderVersion: 'enrichment-controls-v1', sourceHashes, sourceHashesCapturedAt: 'run_start',
    recordedAt: new Date().toISOString(), limitations: 'Targeted term, numeric, structural and closed-facet labels; not complete semantic fidelity, representative data or independent human calibration.' },
    passed: results.every(result => result.pass), results }
  const directory = 'results/evals/enrichment'
  await mkdir(directory,{recursive:true})
  const path = `${directory}/${Date.now()}.json`
  await writeFile(path, JSON.stringify(receipt,null,2))
  printReport('enrichment-source-controls',results)
  console.log(`Report: ${path}`)
}

if (import.meta.main) await main()
