/** D1 cannot cancel in-flight SQL; don't start it or consume its result after cancellation. */
export async function withReadSignal<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const result = await read()
  signal?.throwIfAborted()
  return result
}
