import { describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { createConversationHistoryMachine } from './conversation-history.machine.ts'
import type { ConversationListItem } from '#shared/lib/types.ts'

const row = (id: string): ConversationListItem => ({
	id,
	title: id,
	updated_at: '2026-01-01T00:00:00Z'
})
const settle = async () => {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}

describe('conversation history ownership', () => {
	it('retains rows on refresh, clears them on identity change and ignores the old request', async () => {
		let resolveOld!: (value: { conversations: ConversationListItem[] }) => void
		let resolveNew!: (value: { conversations: ConversationListItem[] }) => void
		let calls = 0
		const actor = createActor(
			createConversationHistoryMachine(() => {
				if (++calls === 1) return Promise.resolve({ conversations: [row('a')] })
				return new Promise((resolve) => {
					if (calls === 2) resolveOld = resolve
					else resolveNew = resolve
				})
			})
		).start()
		actor.send({ type: 'SYNC', userId: 'a', version: 0 })
		await waitFor(actor, (s) => s.matches('ready'))
		actor.send({ type: 'SYNC', userId: 'a', version: 1 })
		expect(actor.getSnapshot().context.conversations).toEqual([row('a')])
		actor.send({ type: 'SYNC', userId: 'b', version: 1 })
		expect(actor.getSnapshot().context.conversations).toEqual([])
		resolveOld({ conversations: [row('old-a')] })
		await settle()
		expect(actor.getSnapshot().context.conversations).toEqual([])
		resolveNew({ conversations: [row('b')] })
		await waitFor(actor, (s) => s.matches('ready'))
		expect(actor.getSnapshot().context.conversations).toEqual([row('b')])
		actor.send({ type: 'SYNC', userId: null, version: 1 })
		expect(actor.getSnapshot().context.conversations).toEqual([])
		actor.stop()
	})
	it('handles failed refreshes and retries without an unhandled rejection', async () => {
		let calls = 0
		const actor = createActor(
			createConversationHistoryMachine(async () => {
				if (++calls === 1) throw new Error('offline')
				return { conversations: [] }
			})
		).start()
		actor.send({ type: 'SYNC', userId: 'a', version: 0 })
		await waitFor(actor, (s) => s.matches('failed'))
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (s) => s.matches('ready'))
		expect(calls).toBe(2)
		actor.stop()
	})
})
