import { beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

type CaseResult = { mode: string; locale: string; calls: number; directionReads: number; detailReads: number; text: string;
  kind: string; eventId?: string; fallback: boolean }

describe('eval-only complete directions tool', () => {
  let results: CaseResult[] = []
  // One subprocess for all cases: a cold Bun start per case exceeded the 5 s test timeout on loaded CI runners.
  beforeAll(async () => {
    const { stdout } = await promisify(execFile)('bun', [fileURLToPath(new URL('./direct-directions.fixture.ts', import.meta.url))], {
      timeout: 60_000, env: { PATH: process.env.PATH, AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false' },
    })
    results = stdout.trim().split('\n').filter(line => line.startsWith('{"mode"')).map(line => JSON.parse(line) as CaseResult)
  }, 60_000)

  for (const mode of ['complete', 'default', 'continue', 'details-first', 'failed', 'ambiguous']) {
    for (const locale of ['en', 'es']) {
      it(`preserves source reads and termination for ${mode}/${locale}`, () => {
        const result = results.find(r => r.mode === mode && r.locale === locale)!
        expect(result).toBeDefined()
        expect(result.fallback).toBe(false)
        expect(result.calls).toBe(mode === 'complete' ? 1 : ['continue', 'details-first'].includes(mode) ? 3 : 2)
        if (mode === 'ambiguous') { expect(result.kind).toBe('clarification'); expect(result.directionReads).toBe(0) }
        else if (['continue', 'details-first'].includes(mode)) { expect(result.detailReads).toBe(1); expect(result.text).toBe('The source describes live jazz.') }
        else {
          expect(result.eventId).toBe('11111111-1111-4111-8111-111111111111')
          expect(result.directionReads).toBe(mode === 'failed' ? 2 : 1)
          if (mode !== 'default') expect(result.text).toBe(locale === 'es' ? 'Abrí el mapa para ver cómo llegar.' : 'Open the map for directions.')
        }
      })
    }
  }
})
