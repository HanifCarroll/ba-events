/** Keep cancellation on the actual PostgREST request, before its lazy execution. */
export function withReadSignal<T extends { abortSignal(signal: AbortSignal): unknown }>(
  query: T,
  signal?: AbortSignal,
): T {
  signal?.throwIfAborted()
  if (signal) query.abortSignal(signal)
  return query
}
