/**
 * Search backend overlap: runs 10 fixed queries through production's Supabase search RPCs and through the D1 and
 * Vectorize search on staging, and reports how many of each top 10 the two share. Every query must reach 70% for
 * lexical search and 80% for semantic search (delivery plan, cutover step 5); the mean is reported, not gated.
 *
 * Read-only on both sides. Production is read through the RPCs with the anon key from `.env`; staging through Wrangler's
 * remote bindings to `wrangler.staging.jsonc` (log in with `bunx wrangler login`). Each query is embedded once with
 * OpenAI (`OPENAI_API_KEY`) and the same vector goes to both sides.
 *
 * Run it with Node, because Wrangler's remote bindings hang under Bun:
 *   node --env-file=.env evals/search/backend-overlap.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import type { D1Database, VectorizeIndex } from '@cloudflare/workers-types'
import { getSupabase, lexicalEventSearch, semanticEventSearch } from '#shared/lib/db/client.server.ts'
import { lexicalEventSearchD1, semanticEventSearchD1 } from '#shared/lib/db/search-d1.server.ts'
import { generateEmbedding } from '#shared/lib/ai/embeddings.ts'
import { OVERLAP_K as K, overlapFailures, topKOverlap as overlap } from './backend-overlap-score.ts'

export const OVERLAP_QUERIES = [
  'tango',
  'jazz en vivo',
  'stand up comedia',
  'rock',
  'feria de diseño',
  'techno',
  'language exchange',
  'teatro',
  'cumbia or reggaeton',
  'yoga or meditación',
]

// The staging config's D1 and Vectorize bindings, marked remote in a throwaway config so nothing local stands in.
const staging = unstable_readConfig({ config: new URL('../../wrangler.staging.jsonc', import.meta.url).pathname }) as {
  account_id: string; compatibility_date: string
  d1_databases: Array<{ binding: string; database_name: string; database_id: string }>
  vectorize: Array<{ binding: string; index_name: string }>
}
if (!staging.d1_databases.every(item => item.database_name.endsWith('-staging'))
  || !staging.vectorize.every(item => item.index_name.endsWith('-staging'))) throw new Error('Only -staging resources may be read')
const dir = mkdtempSync(join(tmpdir(), 'backend-overlap-'))
writeFileSync(join(dir, 'wrangler.json'), JSON.stringify({
  name: 'backend-overlap', account_id: staging.account_id, compatibility_date: staging.compatibility_date,
  d1_databases: staging.d1_databases.map(({ binding, database_name, database_id }) => ({ binding, database_name, database_id, remote: true })),
  vectorize: staging.vectorize.map(({ binding, index_name }) => ({ binding, index_name, remote: true })),
}))
const proxy = await getPlatformProxy<{ DB: D1Database; VECTORIZE: VectorizeIndex }>({
  configPath: join(dir, 'wrangler.json'), remoteBindings: true, envFiles: [], persist: false,
})
try {
  // Events that start in the next hour may turn `past` on one side between the copy and now; leave them out of both.
  const filters = { startsAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
  // Staging is a copy that drifts: the importers being tested write to it, and production keeps changing. Only events
  // that exist on both sides with the same status, start, and searched text are compared, so a drifted event can't
  // count as a ranking difference. How many were left out is reported.
  const POOL = 40
  type Row = { id: string; status: string; starts_at: string; search_document: string | null; name: string }
  const same = async (ids: string[]) => {
    const [production, staging] = await Promise.all([
      getSupabase().from('events').select('id,status,starts_at,search_document,name').in('id', ids)
        .then(({ data, error }) => { if (error) throw error; return data as Row[] }),
      proxy.env.DB.prepare('SELECT id, status, starts_at, search_document, name FROM events WHERE id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(ids)).all<Row>().then(result => result.results),
    ])
    const there = new Map(staging.map(row => [row.id, row]))
    return new Set(production.filter(row => {
      const copy = there.get(row.id)
      return copy && copy.status === row.status && Date.parse(copy.starts_at) === Date.parse(row.starts_at)
        && copy.search_document === row.search_document && copy.name === row.name
    }).map(row => row.id))
  }
  const rows: Array<{ query: string; lexical: number; semantic: number; counts: string }> = []
  let dropped = 0
  for (const query of OVERLAP_QUERIES) {
    const embedding = await generateEmbedding(query)
    const lists = await Promise.all([
      lexicalEventSearch(query, filters, POOL),
      lexicalEventSearchD1(proxy.env.DB, query, filters, POOL),
      semanticEventSearch(query, filters, POOL, undefined, { embedQuery: async () => embedding }),
      semanticEventSearchD1(proxy.env.DB, proxy.env.VECTORIZE, embedding, filters, POOL),
    ])
    const ids = [...new Set(lists.flat().map(row => row.id))]
    const comparable = await same(ids)
    dropped += ids.length - comparable.size
    const [productionLexical, stagingLexical, productionSemantic, stagingSemantic] = lists
      .map(list => list.filter(row => comparable.has(row.id)).slice(0, K))
    rows.push({
      query,
      lexical: overlap(productionLexical, stagingLexical),
      semantic: overlap(productionSemantic, stagingSemantic),
      counts: `${productionLexical.length}/${stagingLexical.length}, ${productionSemantic.length}/${stagingSemantic.length}`,
    })
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const percent = (value: number) => `${Math.round(value * 100)}%`
  console.log('| Query | Lexical top-10 overlap | Semantic top-10 overlap | Results (lexical prod/staging, semantic prod/staging) |')
  console.log('| --- | --- | --- | --- |')
  for (const row of rows) console.log(`| ${row.query} | ${percent(row.lexical)} | ${percent(row.semantic)} | ${row.counts} |`)
  const lexical = mean(rows.map(row => row.lexical))
  const semantic = mean(rows.map(row => row.semantic))
  console.log(`| **Mean** | **${percent(lexical)}** | **${percent(semantic)}** | |`)
  console.log(`Left out ${dropped} candidate events that differ between production and staging.`)
  const failures = overlapFailures(rows)
  console.log(failures.length === 0 ? 'PASS' : `FAIL (every query needs lexical >= 70% and semantic >= 80%): ${failures.join('; ')}`)
  process.exitCode = failures.length === 0 ? 0 : 1
} finally {
  await proxy.dispose()
  rmSync(dir, { recursive: true, force: true })
}
