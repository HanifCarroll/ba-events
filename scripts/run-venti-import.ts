/**
 * One-off script to run a Venti import against the database.
 *
 * Run with: bun scripts/run-venti-import.ts
 */
import { processVentiImport } from '#features/import/core/venti.ts'
import { createServiceRoleClient } from '#trigger/utils/db-client.ts'

async function main() {
  console.log('[run-venti-import] Starting Venti import...')
  const client = createServiceRoleClient()

  const result = await processVentiImport(client, {})
  console.log('[run-venti-import] Result:')
  console.log(JSON.stringify(result, null, 2))
}

main()
  .then(() => {
    console.log('[run-venti-import] Done')
    process.exit(0)
  })
  .catch((error) => {
    console.error('[run-venti-import] Failed:', error)
    process.exit(1)
  })
