import { describe, expect, it } from 'vitest'
import { openEnvelope, sealEnvelope, verifyWorkflowRequest, workflowRequest, EXECUTION_FENCE_HEADER, EXECUTION_STAGE_HEADER } from './recovery.ts'
import { signChatExecution, verifyChatExecution } from '#features/chat/api/delivery-auth.server.ts'
import { deliveryHeaders } from '#features/chat/lib/delivery-protocol.ts'

describe('chat recovery authentication boundaries', () => {
 it('encrypts credentials with object-bound authenticated encryption', async () => {
  const envelope = { url: 'https://baeventos.com/start', headers: [['cookie', 'private-session'], ['x-chat-token', 'a'.repeat(64)]] as [string, string][], body: '{"messages":[]}' }
  const sealed = await sealEnvelope(envelope, 'private-worker-key', 'object-a')
  expect(JSON.stringify(sealed)).not.toContain('private-session'); expect(JSON.stringify(sealed)).not.toContain('a'.repeat(64))
  expect(await openEnvelope(sealed, 'private-worker-key', 'object-a')).toEqual(envelope)
  await expect(openEnvelope(sealed, 'private-worker-key', 'object-b')).rejects.toThrow()
  await expect(openEnvelope({ ...sealed, ciphertext: sealed.ciphertext.slice(0, -2) + (sealed.ciphertext.endsWith('00') ? '01' : '00') }, 'private-worker-key', 'object-a')).rejects.toThrow()
 })
 it('authenticates workflow action, object name and stage', async () => {
  const request = await workflowRequest('key', 'object-a', 'run', 'generate')
  expect(await verifyWorkflowRequest(request, 'key')).toBe(true)
  expect(await verifyWorkflowRequest(new Request(request.url.replace('generate', 'commit'), { method: 'POST', headers: request.headers }), 'key')).toBe(false)
  expect(await verifyWorkflowRequest(new Request(request.url.replace('object-a', 'object-b'), { method: 'POST', headers: request.headers }), 'key')).toBe(false)
  expect(await verifyWorkflowRequest(await workflowRequest('key', 'object-a', 'interrupt'), 'another-key')).toBe(false)
 })
 it('binds upstream execution authentication to the fence and stage, while accepting legacy signatures', async () => {
  const identity = { turnId: crypto.randomUUID(), attemptId: crypto.randomUUID(), token: 'a'.repeat(64) }
  const headers = new Headers({ ...deliveryHeaders(identity), 'x-chat-turn': identity.turnId, 'x-chat-owner': 'guest' })
  await signChatExecution(headers, 'key'); expect(await verifyChatExecution(headers, 'key')).toBe(true)
  headers.set(EXECUTION_FENCE_HEADER, '1'); headers.set(EXECUTION_STAGE_HEADER, 'generate')
  await signChatExecution(headers, 'key'); expect(await verifyChatExecution(headers, 'key')).toBe(true)
  headers.set(EXECUTION_FENCE_HEADER, '2'); expect(await verifyChatExecution(headers, 'key')).toBe(false)
  headers.set(EXECUTION_FENCE_HEADER, '1'); headers.set(EXECUTION_STAGE_HEADER, 'commit'); expect(await verifyChatExecution(headers, 'key')).toBe(false)
 })
})
