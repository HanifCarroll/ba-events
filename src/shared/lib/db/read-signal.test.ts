import { expect, it, vi } from 'vitest'
import { withReadSignal } from './read-signal.ts'

it('does not dispatch a read after cancellation', async () => {
  const read = vi.fn(async () => 'row')
  await expect(withReadSignal(read, AbortSignal.abort('canceled'))).rejects.toBe('canceled')
  expect(read).not.toHaveBeenCalled()
})

it('does not deliver a result after cancellation during a read', async () => {
  const controller = new AbortController()
  const read = Promise.withResolvers<string>()
  const result = withReadSignal(() => read.promise, controller.signal)
  controller.abort('canceled')
  read.resolve('row')
  await expect(result).rejects.toBe('canceled')
})
