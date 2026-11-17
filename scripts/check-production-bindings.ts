/**
 * Refuses a production deploy while a production wrangler config still has the D1 cutover placeholder
 * (docs/ops/d1-cutover.md). Hermes replaces it with the id of `baeventos-production` when he creates the database.
 * Run by the CI deploy job before the migrations and the Workers deploy: `bun scripts/check-production-bindings.ts`.
 */
import { readFileSync } from 'node:fs'

export const PRODUCTION_CONFIGS = ['wrangler.jsonc', 'wrangler.mcp.jsonc', 'wrangler.telegram.jsonc', 'wrangler.jobs.jsonc']
export const PLACEHOLDER = 'REPLACE_WITH_BAEVENTOS_PRODUCTION_D1_ID'

/** The configs that still hold the placeholder, or bind a D1 other than `baeventos-production` with a different id. */
export function unfilledConfigs(read: (file: string) => string): string[] {
  const ids = new Map<string, string>()
  const problems: string[] = []
  for (const file of PRODUCTION_CONFIGS) {
    const text = read(file)
    if (text.includes(PLACEHOLDER)) problems.push(`${file}: database_id is still the placeholder`)
    for (const [, id] of text.matchAll(/"database_name":\s*"baeventos-production",\s*"database_id":\s*"([^"]+)"/g)) ids.set(file, id!)
    if (!ids.has(file)) problems.push(`${file}: no baeventos-production D1 binding`)
  }
  if (new Set(ids.values()).size > 1) problems.push('the production configs bind different database ids')
  return problems
}

if (import.meta.main) {
  const problems = unfilledConfigs((file) => readFileSync(file, 'utf8'))
  if (problems.length) {
    console.error(`Refusing to deploy: ${problems.join('; ')}. See docs/ops/d1-cutover.md.`)
    process.exit(1)
  }
  console.log('Production configs bind baeventos-production.')
}
