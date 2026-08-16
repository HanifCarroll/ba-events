import { describe, expect, it } from 'vitest'
import { Chat } from '@ai-sdk/svelte'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import { buildStreamOpeningChunks } from '#features/chat/api/stream-helpers.ts'

/**
 * End-to-end regression for the chat stream correlation contract.
 *
 * The server emits a `start` chunk (carrying the assistant message id) before
 * any `data-*` status chunk. This test feeds those real chunks — plus the
 * text-start/delta/end and finish chunks the route also emits — through the
 * installed AI SDK Chat client and asserts the client correlates them into
 * exactly ONE assistant message bearing the server-assigned id. If the server
 * ever flips to `data-status` before `start`, the client commits a phantom
 * assistant message on the first chunk (before `start` sets the id) and the
 * "exactly one" assertion fails.
 */

function streamOf(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function transport(chunks: UIMessageChunk[]): ChatTransport<UIMessage> {
  return {
    sendMessages: async () => streamOf(chunks),
    reconnectToStream: async () => null,
  }
}

describe('chat stream client correlation', () => {
  it('correlates opening/data/text chunks into exactly one assistant message with the server id', async () => {
    const messageId = 'assistant-server-1'
    const requestId = 'request-1'
    const textId = 'text-1'

    const opening = buildStreamOpeningChunks(
      messageId,
      requestId,
      '2026-08-16T00:00:00.000Z',
    )

    const chunks: UIMessageChunk[] = [
      ...opening,
      { type: 'text-start', id: textId },
      { type: 'text-delta', id: textId, delta: 'Hello from' },
      { type: 'text-delta', id: textId, delta: ' the server' },
      { type: 'text-end', id: textId },
      { type: 'finish', finishReason: 'stop' },
    ]

    const chat = new Chat<UIMessage>({
      id: 'stream-regression',
      transport: transport(chunks),
    })

    await chat.sendMessage({ text: 'hello' })

    const assistant = chat.messages.filter((m) => m.role === 'assistant')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]?.id).toBe(messageId)

    const textPart = assistant[0]?.parts?.find((p) => p.type === 'text')
    expect(textPart?.text).toBe('Hello from the server')
  })

})
