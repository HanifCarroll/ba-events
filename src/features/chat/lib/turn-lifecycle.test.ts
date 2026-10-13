import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { Chat as ChatClass } from '@ai-sdk/svelte'
import type { UIMessageChunk, ChatTransport, UIMessage } from 'ai'
import { bootstrapGuestTurn, claimGuestTurn, getGuestConversationWithMessages } from '#shared/lib/db/guest-conversations.ts'
import { adaptStoredMessageToCanonical } from './canonical.ts'
import { ChatTurnStoppedError, createTurnLifecycle, ownsClientTurn, type ClientTurn } from './turn-lifecycle.ts'

const canonical = adaptStoredMessageToCanonical({ id: 'reply', content: 'A complete reply' })
const success: UIMessageChunk[] = [
	{ type: 'start', messageId: 'reply' },
	{ type: 'data-response', data: canonical },
	{ type: 'finish', finishReason: 'stop' },
]

async function loadChat(): Promise<typeof ChatClass> {
	return ((process.versions as { bun?: string }).bun
		? await import('../../../../node_modules/@ai-sdk/svelte/dist/index.js')
		: await import('@ai-sdk/svelte')).Chat as typeof ChatClass
}

function transport(chunks: UIMessageChunk[]): ChatTransport<UIMessage> {
	return {
		sendMessages: async () => new ReadableStream({ start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk)
			controller.close()
		} }),
		reconnectToStream: async () => null,
	}
}

async function setup(claim = true) {
	const turn: ClientTurn = {
		conversationId: crypto.randomUUID(), startingConversationId: null,
		turnId: crypto.randomUUID(), claimId: crypto.randomUUID(),
		userClientMessageId: crypto.randomUUID(), assistantClientMessageId: crypto.randomUUID(),
		content: 'Events tonight', locale: 'en', userId: null,
	}
	await bootstrapGuestTurn(turn)
	if (claim) await claimGuestTurn(turn.turnId, turn.claimId)
	const owner = { activeTurn: turn as ClientTurn | null, conversationId: turn.conversationId as string | null, userId: null as string | null }
	const outcomes: string[] = []
	const lifecycle = createTurnLifecycle(turn, {
		isCurrent: () => ownsClientTurn(turn, owner),
		onPhase: (phase) => outcomes.push(phase),
		onFailure: () => outcomes.push('failure'),
		onComplete: () => { outcomes.push('success') },
	})
	return { turn, owner, outcomes, lifecycle }
}

describe('browser turn lifecycle with the real chat SDK and guest store', () => {
	it('defers terminal callbacks while Stop races the authoritative commit gate', async () => {
		const stopped = await setup(); expect(stopped.lifecycle.beginStop()).toBe(true)
		stopped.lifecycle.callbacks.onError?.(new Error('Response stopped'))
		stopped.lifecycle.callbacks.onFinish?.({ message: { id: 'reply', role: 'assistant', parts: [{ type: 'data-response', data: canonical }] }, messages: [], isAbort: false, isError: false, isDisconnect: false, finishReason: 'stop' })
		expect(stopped.outcomes).toEqual([])
		stopped.lifecycle.endStop(true); await stopped.lifecycle.settled()
		expect(stopped.outcomes).toEqual(['failure'])
		expect((await getGuestConversationWithMessages(stopped.turn.conversationId))?.messages.length).toBe(1)
		const committed = await setup(); committed.lifecycle.beginStop()
		committed.lifecycle.callbacks.onFinish?.({ message: { id: 'reply', role: 'assistant', parts: [{ type: 'data-response', data: canonical }] }, messages: [], isAbort: false, isError: false, isDisconnect: false, finishReason: 'stop' })
		committed.lifecycle.endStop(false); await committed.lifecycle.settled()
		expect(committed.outcomes).toEqual(['persisting', 'success'])
	})
	it('detaching preserves a guest claim for replay and suppresses callbacks in the new view', async () => {
		const { turn, lifecycle, outcomes } = await setup()
		lifecycle.detach(); lifecycle.callbacks.onError?.(new Error('Browser disconnected')); await lifecycle.settled()
		expect((await getGuestConversationWithMessages(turn.conversationId))?.turns?.[0].status).toBe('running')
		expect(outcomes).toEqual([])
	})
	it('an intentional Stop that is acknowledged after navigation still releases only its own guest claim', async () => {
		const { turn, lifecycle, outcomes } = await setup()
		lifecycle.beginStop(); lifecycle.detach(); lifecycle.endStop(true); await lifecycle.settled()
		expect((await getGuestConversationWithMessages(turn.conversationId))?.turns?.[0].status).toBe('failed')
		expect(outcomes).toEqual([])
	})
	it('releases a guest claim that arrives after a preparation stop', async () => {
		const { turn, lifecycle, outcomes } = await setup(false)
		lifecycle.stop()
		await lifecycle.settled()
		expect(outcomes).toEqual(['failure'])
		const lateClaim = await claimGuestTurn(turn.turnId, turn.claimId)
		expect(lateClaim?.status).toBe('running')
		// The send owner's stillCurrent check releases a claim that settled late.
		lifecycle.cancel()
		await lifecycle.settled()
		const stored = await getGuestConversationWithMessages(turn.conversationId)
		expect(stored?.turns?.[0].status).toBe('failed')
		expect(stored?.messages.map((message) => message.role)).toEqual(['user'])
		expect(outcomes).toEqual(['failure'])
	})

	it('stops an active SDK request without persisting a partial assistant and retries the original turn', async () => {
		const { turn, lifecycle, outcomes } = await setup()
		const Chat = await loadChat()
		let started!: () => void
		const ready = new Promise<void>((resolve) => { started = resolve })
		const chat = new Chat({ ...lifecycle.callbacks, transport: {
			sendMessages: async () => new ReadableStream({ start(controller) {
				controller.enqueue({ type: 'start', messageId: turn.assistantClientMessageId })
				controller.enqueue({ type: 'text-start', id: 'partial' })
				controller.enqueue({ type: 'text-delta', id: 'partial', delta: 'Incomplete reply' })
				started()
			} }),
			reconnectToStream: async () => null,
		} })
		const request = chat.sendMessage({ id: turn.userClientMessageId, role: 'user', parts: [{ type: 'text', text: turn.content }] })
		await ready
		expect(lifecycle.stop()).toBe(true)
		expect(lifecycle.stop()).toBe(false)
		await chat.stop()
		await request
		await lifecycle.settled()
		const stopped = await getGuestConversationWithMessages(turn.conversationId)
		expect(outcomes).toEqual(['failure'])
		expect(stopped?.messages.map((message) => message.role)).toEqual(['user'])
		expect(stopped?.turns?.[0].status).toBe('failed')

		const retry = { ...turn, claimId: crypto.randomUUID() }
		await bootstrapGuestTurn(retry)
		await claimGuestTurn(retry.turnId, retry.claimId, true)
		const retryLifecycle = createTurnLifecycle(retry, {
			isCurrent: () => true, onPhase: () => {}, onFailure: () => outcomes.push('retry failure'), onComplete: () => { outcomes.push('success') },
		})
		await new Chat({ ...retryLifecycle.callbacks, transport: transport(success) }).sendMessage({ text: turn.content })
		await retryLifecycle.settled()
		const stored = await getGuestConversationWithMessages(turn.conversationId)
		expect(outcomes).toEqual(['failure', 'success'])
		expect(stored?.messages.map((message) => message.id).sort()).toEqual([turn.userClientMessageId, turn.assistantClientMessageId].sort())
	})

	it('preserves a stopped outcome when a late completion arrives', async () => {
		const { lifecycle, outcomes, turn } = await setup()
		let failure: Error | undefined
		const stopped = createTurnLifecycle(turn, {
			isCurrent: () => true, onPhase: () => {}, onFailure: (error) => { failure = error }, onComplete: () => { outcomes.push('late success') },
		})
		stopped.stop()
		await stopped.settled()
		const Chat = await loadChat()
		await new Chat({ ...stopped.callbacks, transport: transport(success) }).sendMessage({ text: turn.content })
		await stopped.settled()
		expect(failure).toBeInstanceOf(ChatTurnStoppedError)
		expect(outcomes).toEqual([])
		expect((await getGuestConversationWithMessages(turn.conversationId))?.messages).toHaveLength(1)
		lifecycle.cancel()
	})

	it('does not stop after canonical persistence has begun', async () => {
		const { lifecycle, outcomes, turn } = await setup()
		const Chat = await loadChat()
		await new Chat({ ...lifecycle.callbacks, transport: transport(success) }).sendMessage({ text: turn.content })
		expect(lifecycle.stop()).toBe(false)
		await lifecycle.settled()
		expect(outcomes).toEqual(['persisting', 'success'])
		expect((await getGuestConversationWithMessages(turn.conversationId))?.turns?.[0].status).toBe('completed')
	})

	it('handles error followed by finish once, without saving an assistant', async () => {
		const { turn, lifecycle, outcomes } = await setup()
		const Chat = await loadChat()
		const chat = new Chat({ ...lifecycle.callbacks, transport: transport([
			{ type: 'start', messageId: 'reply' },
			{ type: 'error', errorText: 'Provider unavailable' },
			{ type: 'finish', finishReason: 'error' },
		]) })
		await chat.sendMessage({ text: turn.content })
		await lifecycle.settled()
		const stored = await getGuestConversationWithMessages(turn.conversationId)
		expect(outcomes).toEqual(['failure'])
		expect(stored?.messages.map((message) => message.role)).toEqual(['user'])
		expect(stored?.turns?.[0].status).toBe('failed')
	})

	it('persists the canonical once before reporting success', async () => {
		const { turn, lifecycle, outcomes } = await setup()
		const Chat = await loadChat()
		const chat = new Chat({ ...lifecycle.callbacks, transport: transport(success) })
		await chat.sendMessage({ text: turn.content })
		await lifecycle.settled()
		const stored = await getGuestConversationWithMessages(turn.conversationId)
		expect(outcomes).toEqual(['persisting', 'success'])
		expect(stored?.messages.find((message) => message.role === 'assistant')).toMatchObject({ id: turn.assistantClientMessageId, attached_data: { canonical } })
		expect(stored?.turns?.[0].status).toBe('completed')
	})

	it('rejects a cleanly closed stream without a final canonical or finish marker', async () => {
		const Chat = await loadChat()
		for (const chunks of [
			[{ type: 'start', messageId: 'reply' }, { type: 'finish', finishReason: 'stop' }],
			success.slice(0, -1),
		] as UIMessageChunk[][]) {
			const { turn, lifecycle, outcomes } = await setup()
			const chat = new Chat({ ...lifecycle.callbacks, transport: transport(chunks) })
			await chat.sendMessage({ text: turn.content })
			await lifecycle.settled()
			expect(outcomes).toEqual(['failure'])
			expect((await getGuestConversationWithMessages(turn.conversationId))?.messages).toHaveLength(1)
		}
	})

	it('cancels during navigation and ignores the old finish after a new attempt starts', async () => {
		const { turn, owner, lifecycle, outcomes } = await setup()
		const Chat = await loadChat()
		let started!: () => void
		const ready = new Promise<void>((resolve) => { started = resolve })
		const oldChat = new Chat({ ...lifecycle.callbacks, transport: {
			sendMessages: async () => new ReadableStream({ start(controller) {
				controller.enqueue({ type: 'start', messageId: 'old-reply' })
				started()
			} }),
			reconnectToStream: async () => null,
		} })
		const oldRequest = oldChat.sendMessage({ text: turn.content })
		await ready
		owner.activeTurn = null
		owner.conversationId = 'another-conversation'
		lifecycle.cancel()
		const next = await setup()
		owner.activeTurn = next.turn
		const newChat = new Chat({ ...next.lifecycle.callbacks, transport: transport(success) })
		await newChat.sendMessage({ text: next.turn.content })
		await next.lifecycle.settled()
		await oldChat.stop()
		await oldRequest
		await lifecycle.settled()
		expect(outcomes).toEqual([])
		expect(next.outcomes).toEqual(['persisting', 'success'])
		expect(newChat.messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
		expect((await getGuestConversationWithMessages(turn.conversationId))?.messages).toHaveLength(1)
	})

	it('does not apply success bookkeeping after ownership changes during persistence', async () => {
		const { turn, owner, lifecycle, outcomes } = await setup()
		const Chat = await loadChat()
		const chat = new Chat({ ...lifecycle.callbacks, transport: transport(success) })
		await chat.sendMessage({ text: turn.content })
		// IndexedDB completion is asynchronous; the stream has already finished.
		owner.userId = 'newly-signed-in-user'
		await lifecycle.settled()
		expect(outcomes).toEqual(['persisting'])
		expect((await getGuestConversationWithMessages(turn.conversationId))?.turns?.[0].status).toBe('completed')
	})

	it('rejects an older completion after explicit retry using the same message ids', async () => {
		const { turn, lifecycle, owner } = await setup()
		owner.activeTurn = null
		lifecycle.cancel()
		await lifecycle.settled()
		const retried = { ...turn, claimId: crypto.randomUUID() }
		await bootstrapGuestTurn(retried)
		await claimGuestTurn(retried.turnId, retried.claimId, true)
		const outcomes: string[] = []
		const retryLifecycle = createTurnLifecycle(retried, {
			isCurrent: () => true, onPhase: () => {}, onFailure: () => outcomes.push('failure'), onComplete: () => { outcomes.push('success') },
		})
		const Chat = await loadChat()
		await new Chat({ ...retryLifecycle.callbacks, transport: transport(success) }).sendMessage({ text: turn.content })
		await retryLifecycle.settled()
		await new Chat({ ...lifecycle.callbacks, transport: transport(success) }).sendMessage({ text: turn.content })
		await lifecycle.settled()
		const stored = await getGuestConversationWithMessages(turn.conversationId)
		expect(outcomes).toEqual(['success'])
		expect(stored?.messages.map((message) => message.id).sort()).toEqual([turn.userClientMessageId, turn.assistantClientMessageId].sort())
		expect(stored?.turns?.[0].claim_id).toBe(retried.claimId)
	})

	it('accepts first-route adoption but rejects another account or attempt', async () => {
		const { turn, owner } = await setup()
		owner.conversationId = null
		expect(ownsClientTurn(turn, owner)).toBe(true)
		owner.conversationId = turn.conversationId
		expect(ownsClientTurn(turn, owner)).toBe(true)
		owner.userId = 'another-user'
		expect(ownsClientTurn(turn, owner)).toBe(false)
		owner.userId = null
		owner.activeTurn = { ...turn }
		expect(ownsClientTurn(turn, owner)).toBe(false)
	})
})
