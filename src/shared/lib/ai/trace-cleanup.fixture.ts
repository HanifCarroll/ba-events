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
let retainedSettled = false
let runs = 0
const controller = new AbortController()
const owning = Effect.runPromise(Effect.tryPromise({
  try: signal => traceConcierge({ messages: [], retainTask: task => {
    retained.push(task)
    void task.then(() => { retainedSettled = true }, () => { retainedSettled = true })
  } }, async () => {
    runs++
    runStarted()
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new CleanupFixtureError({})), { once: true }))
    return { text: '', steps: [] }
  }),
  catch: cause => new CleanupFixtureError({ cause }),
}), { signal: controller.signal }).then(() => false, () => true)
await started
controller.abort()
const interrupted = await owning
await flushing
const retainedPendingAfterInterruption = retained.length === 1 && !retainedSettled
releaseFlush()
await Promise.allSettled(retained)
console.log(JSON.stringify({ interrupted, retainedPendingAfterInterruption, cleanupSettled: retainedSettled, runs, networkCalls }))
process.exit(0)
