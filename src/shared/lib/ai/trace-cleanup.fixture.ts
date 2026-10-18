import { Data, Effect } from 'effect'
import { initializeLangfuse, traceConcierge } from './langfuse.server.ts'

class CleanupFixtureError extends Data.TaggedError('CleanupFixtureError')<{ cause?: unknown }> {}

let networkCalls = 0
globalThis.fetch = async () => { networkCalls++; throw new Error('No network allowed in cleanup fixture') }
const sdk = await initializeLangfuse()
if (!sdk) throw new Error('Fixture tracing must be configured')
let releaseFlush!: () => void
let flushStarted!: () => void
const flushing = new Promise<void>(resolve => { flushStarted = resolve })
const flush = new Promise<void>(resolve => { releaseFlush = resolve })
sdk.processor.forceFlush = () => { flushStarted(); return flush }
let runStarted!: () => void
const started = new Promise<void>(resolve => { runStarted = resolve })
const retained: Promise<unknown>[] = []
const pending = new Set<Promise<unknown>>()
let runs = 0
const mode = process.argv[2] ?? 'interrupted'
const controller = new AbortController()
let owningSettled = false
const owning = Effect.runPromise(Effect.tryPromise({
  try: signal => traceConcierge({ messages: [], ...(mode === 'unretained' ? {} : { retainTask: (task: Promise<unknown>) => {
    if (mode === 'retention-error') throw new Error('Lifecycle unavailable')
    retained.push(task); pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
  } }) }, async () => {
    runs++
    runStarted()
    if (mode === 'interrupted') await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new CleanupFixtureError({})), { once: true }))
    return { text: 'Grounded answer', steps: [] }
  }),
  catch: cause => new CleanupFixtureError({ cause }),
}), { signal: controller.signal }).then(() => { owningSettled = true; return false }, () => { owningSettled = true; return true })
await started
if (mode === 'interrupted') controller.abort()
await flushing
if (mode === 'interrupted' || mode === 'completed') await owning
else await new Promise(resolve => setTimeout(resolve, 0))
const returnedBeforeFlush = owningSettled
const retainedPendingAfterInterruption = pending.size > 0
releaseFlush()
await Promise.allSettled(retained)
const interrupted = await owning
console.log(JSON.stringify({ interrupted, returnedBeforeFlush, retainedPendingAfterInterruption, cleanupSettled: pending.size === 0, runs, networkCalls }))
process.exit(0)
