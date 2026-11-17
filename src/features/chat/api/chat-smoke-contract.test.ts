/**
 * The runbook's guest smoke test (`scripts/chat-smoke.ts`) must speak the current `/api/chat` protocol: the body the
 * route parses and the delivery capability headers it checks before forwarding (docs/ops/d1-cutover.md, step 6).
 */
import { describe, expect, it } from 'vitest'
import { guestChatRequest } from '../../../../scripts/chat-smoke.ts'
import { parseMainChatRequest } from './main-request.ts'
import { parseDeliveryIdentity } from '#features/chat/lib/delivery-protocol.ts'
import { POST } from '../../../routes/api/chat/+server.ts'

describe('chat-smoke guest request', () => {
  it('has the ids and capability the chat route requires', () => {
    const { headers, body } = guestChatRequest('jazz this weekend', 'es')
    const parsed = parseMainChatRequest(JSON.parse(JSON.stringify(body)))
    expect(parsed).toMatchObject({ locale: 'es', turnId: body.turnId, conversationId: body.conversationId })
    expect(parsed?.messages?.[0]?.parts).toEqual([{ type: 'text', text: 'jazz this weekend' }])
    expect(parseDeliveryIdentity(body.turnId, new Headers(headers))).not.toBeNull()
  })

  it('reaches the delivery binding instead of failing validation with 400', async () => {
    const { headers, body } = guestChatRequest('jazz', 'en')
    const event = { request: new Request('https://example.com/api/chat', { method: 'POST', headers, body: JSON.stringify(body) }), platform: { env: {} }, locals: {} }
    // Without a CHAT_DELIVERY binding the route answers 503 only after the request validated.
    expect((await POST(event as never)).status).toBe(503)
    const invalid = { ...event, request: new Request('https://example.com/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
    expect((await POST(invalid as never)).status).toBe(400)
  })
})
