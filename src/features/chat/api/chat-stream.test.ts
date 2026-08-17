import { describe, expect, it } from 'vitest'
import type { Chat as ChatClass } from '@ai-sdk/svelte'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'

// `@ai-sdk/svelte` only exposes a `svelte` export condition, which Bun's test
// runtime cannot resolve from the bare specifier. Vitest (through the SvelteKit
// vite pipeline) resolves the bare specifier; Bun resolves the compiled entry
// directly. Both load the real `Chat` class — only the specifier differs.
type ChatModule = { Chat: typeof ChatClass }

async function loadChatModule(): Promise<ChatModule> {
	if ((process.versions as { bun?: string }).bun) {
		return (await import(
			'../../../../node_modules/@ai-sdk/svelte/dist/index.js'
		)) as unknown as ChatModule
	}
	return (await import('@ai-sdk/svelte')) as unknown as ChatModule
}

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

const canonical: CanonicalChatResponse = {
	contractVersion: CHAT_CONTRACT_VERSION,
	requestId: 'request-1',
	kind: 'recommendations',
	messageKey: 'recommendations',
	text: 'Go to Tango night.',
	events: [{ id: 'e1', name: 'Tango night', saved: null } as never],
	directions: null,
	venue: null,
	operations: [
		{
			toolCallId: 'op-1',
			toolName: 'save_event',
			eventId: 'e1',
			outcome: 'applied',
			message: 'Saved it to your list.'
		}
	],
	suggestions: [],
	clarificationQuestions: [{ key: 'which_day', label: 'Which day are you interested in?' }],
	provenance: {
		sourceToolCallIds: ['s1'],
		directionToolCallIds: [],
		venueToolCallIds: [],
		mutationToolCallIds: ['op-1'],
		suggestionToolCallIds: [],
		emptySourceToolCallIds: [],
		retainedSourceToolCallIds: [],
		stageIds: [],
		searchAttemptToolCallIds: [],
		origin: 'validated',
		fallbackUsed: false,
		fallbackReason: null
	}
}

describe('v4 chat stream client correlation', () => {
	it('correlates into exactly one assistant message with one text part and a persistent data-response part', async () => {
		const messageId = 'assistant-server-1'
		const requestId = 'request-1'
		const textId = 'text-1'

		const chunks: UIMessageChunk[] = [
			{ type: 'start', messageId },
			{ type: 'data-status', id: `status:${requestId}`, transient: true, data: { phase: 'thinking', requestId } },
			{ type: 'data-status', id: `status:${requestId}`, transient: true, data: { phase: 'calling_tool', requestId } },
			{ type: 'text-start', id: textId },
			{ type: 'text-delta', id: textId, delta: 'Go to Tango night.' },
			{ type: 'text-end', id: textId },
			{ type: 'data-response', data: canonical },
			{ type: 'data-execution-trace', id: `trace:${requestId}`, transient: true, data: { requestId, assistantMessageId: messageId, steps: [] } },
			{ type: 'finish', finishReason: 'stop' }
		]

		const { Chat } = await loadChatModule()
		const chat = new Chat<UIMessage>({
			id: 'v4-stream-regression',
			transport: transport(chunks)
		})

		await chat.sendMessage({ text: 'romantic night' })

		const assistants = chat.messages.filter((m) => m.role === 'assistant')
		expect(assistants).toHaveLength(1)
		expect(assistants[0]?.id).toBe(messageId)

		const textParts = assistants[0]?.parts?.filter((p) => p.type === 'text')
		expect(textParts).toHaveLength(1)
		expect(textParts?.[0]?.text).toBe('Go to Tango night.')

		const responseParts = assistants[0]?.parts?.filter((p) => p.type === 'data-response')
		expect(responseParts).toHaveLength(1)
		const responseData = (responseParts?.[0] as { data: CanonicalChatResponse }).data
		expect(responseData.requestId).toBe('request-1')
		expect(responseData.contractVersion).toBe(CHAT_CONTRACT_VERSION)

		// Clarification questions are v4 canonical data, not a second text block.
		expect(responseData.clarificationQuestions).toHaveLength(1)
		expect(textParts).toHaveLength(1)

		// Deterministic contract: canonical.text never duplicates the
		// separately-rendered operation receipt message.
		for (const op of responseData.operations) {
			expect(responseData.text).not.toContain(op.message)
		}

		// Transient status parts must never enter the persisted message history.
		const statusParts = assistants[0]?.parts?.filter((p) => p.type === 'data-status')
		expect(statusParts).toHaveLength(0)
	})
})
