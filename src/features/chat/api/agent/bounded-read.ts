/** Native cancellation boundary for AI SDK tool callbacks. */
export class ReadTimeoutError extends Error {
  override name = 'ReadTimeoutError'
}

export async function boundedRead<A>(
  read: (signal: AbortSignal) => Promise<A>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<A> {
  parentSignal?.throwIfAborted()
  const timeout = new AbortController()
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout.signal]) : timeout.signal
  let rejectAbort: (reason: unknown) => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = () => rejectAbort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => timeout.abort(new ReadTimeoutError('Tool read timed out')), timeoutMs)
  try {
    const result = await Promise.race([read(signal), aborted])
    signal.throwIfAborted()
    return result
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    // Close the read scope, including parallel requests left by an early failure.
    timeout.abort()
  }
}
