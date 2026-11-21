import { command } from '$app/server'
import { expect, it, vi } from 'vitest'
import './messages.remote.ts'

vi.mock('$app/server', async (load) => {
  const server = await load<typeof import('$app/server')>()
  return { ...server, command: vi.fn(server.command) }
})
vi.mock('#features/chat/api/messages.server.ts', () => ({ addMessageEffect: vi.fn(), updateMessageAttachedDataEffect: vi.fn() }))

it('keeps the addMessage validation issue for a nonnumeric response contract version', async () => {
  const [schema] = vi.mocked(command).mock.calls[0]
  const input = { conversationId: 'synthetic-id', role: 'user', content: 'Synthetic message' }
  expect(await schema['~standard'].validate({ ...input, responseContractVersion: 'invalid' })).toEqual({
    issues: [{ path: ['responseContractVersion'], message: 'Expected number | undefined' }],
  })
  expect(await schema['~standard'].validate({ ...input, responseContractVersion: 99 })).toEqual({
    value: { ...input, responseContractVersion: 99 },
  })
})
