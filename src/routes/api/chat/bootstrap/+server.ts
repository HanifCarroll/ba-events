import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { normalizeChatTurn } from '#features/chat/api/agent/shared-turn.server.ts'
import { parseChatTurnBootstrapInput } from '#features/chat/api/turn-authority.ts'
import { bootstrapChatTurn } from '#features/chat/api/turns.server.ts'

export const POST: RequestHandler = async (event) => {
  if (!event.locals.user) return json({ error: 'Not authenticated' }, { status: 401 })
  const body = await event.request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, { status: 400 })

  const input = parseChatTurnBootstrapInput(body)
  if (!input) return json({ error: 'Invalid request' }, { status: 400 })

  const normalized = normalizeChatTurn(input.content, input.locale)
  if (!normalized.originalQuery) return json({ error: 'Invalid request' }, { status: 400 })

  try {
    const turn = await bootstrapChatTurn(event, {
      conversationId: input.conversationId,
      turnId: input.turnId,
      userClientMessageId: input.userClientMessageId,
      assistantClientMessageId: input.assistantClientMessageId,
      content: normalized.originalQuery,
      locale: normalized.locale,
    })
    return json({ turn })
  } catch {
    return json({ error: 'Unable to save chat turn' }, { status: 409 })
  }
}
