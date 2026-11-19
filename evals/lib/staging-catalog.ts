import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import { useD1Binding } from '#shared/lib/db/d1-binding.server.ts'
import { cloudflareSearchBackend, useCloudflareBindings } from '#shared/lib/db/search-bindings.server.ts'

const configPath = fileURLToPath(new URL('../../wrangler.staging.jsonc', import.meta.url))

/** Live evals may only bind the staging catalog, never chat, auth, or storage resources. */
export async function openStagingCatalog(
  target: string | undefined,
  connect: (path: string) => Promise<{ env: unknown; dispose: () => Promise<void> }> =
    (path) => getPlatformProxy({ configPath: path, remoteBindings: true, envFiles: [], persist: false }),
): Promise<AsyncDisposable> {
  if (target !== '--staging') throw new Error('Live evaluation requires --staging as its first argument')
  const config = unstable_readConfig({ config: configPath })
  const [db] = config.d1_databases
  const [index] = config.vectorize
  if (db?.binding !== 'DB' || db.database_name !== 'baeventos-staging' ||
      index?.binding !== 'VECTORIZE' || index.index_name !== 'baeventos-events-staging') {
    throw new Error('Unexpected D1 or Vectorize target in wrangler.staging.jsonc')
  }

  const dir = await mkdtemp(join(tmpdir(), 'ba-eval-staging-'))
  let proxy: Awaited<ReturnType<typeof connect>> | undefined
  async function dispose() {
    useD1Binding(null)
    useCloudflareBindings(null)
    try { await proxy?.dispose() }
    finally { await rm(dir, { recursive: true, force: true }) }
  }
  try {
    const path = join(dir, 'wrangler.json')
    await writeFile(path, JSON.stringify({
      name: 'baeventos-eval-staging', account_id: config.account_id, compatibility_date: config.compatibility_date,
      d1_databases: [{ binding: 'DB', database_name: db.database_name, database_id: db.database_id, remote: true }],
      vectorize: [{ binding: 'VECTORIZE', index_name: index.index_name, remote: true }],
    }))
    proxy = await connect(path)
    useD1Binding(proxy.env)
    useCloudflareBindings(proxy.env)
    if (!cloudflareSearchBackend().vectorize) throw new Error('Missing staging VECTORIZE binding')
    return { [Symbol.asyncDispose]: dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
