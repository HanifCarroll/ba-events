import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EMBEDDING_TASK_LIMIT } from '../src/jobs-worker/catalog-maintenance.ts'

export function submitEmbeddingTask(task: 'populate-embeddings' | 'reembed-stale', args: string[]) {
  const usage = `bun scripts/${task}.ts --staging|--production [--limit 1..${EMBEDDING_TASK_LIMIT}]`
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return }
  const [target, flag, value] = args
  const limit = flag === undefined ? EMBEDDING_TASK_LIMIT : Number(value)
  if ((target !== '--staging' && target !== '--production') ||
      (args.length !== 1 && (args.length !== 3 || flag !== '--limit')) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > EMBEDDING_TASK_LIMIT) {
    console.error(usage)
    process.exitCode = 1
    return
  }
  const staging = target === '--staging'
  const name = staging ? 'baeventos-catalog-task-staging' : 'baeventos-catalog-task'
  const config = staging ? 'wrangler.jobs.staging.jsonc' : 'wrangler.jobs.jsonc'
  const id = `${task}-${randomUUID()}`
  const result = spawnSync('bunx', ['--no-install', 'wrangler', 'workflows', 'trigger', name,
    JSON.stringify({ task, limit }), '--config', config, '--id', id], { stdio: 'inherit', timeout: 90_000 })
  if (result.status !== 0) process.exitCode = 1
  // A timeout can still mean the submission reached Cloudflare. Inspect this exact run before retrying.
  console.log(`Check instance ${id} for the outcome: bunx wrangler workflows instances describe ${name} ${id} --config ${config}`)
}
