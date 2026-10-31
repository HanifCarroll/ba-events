import { createActor, createAsyncLogic } from 'xstate'
import { describe, expect, it } from 'vitest'
import { guestConversationMachine, type GuestConversationRead } from './guest-conversation.machine.ts'
import type { GuestConversationWithMessages } from '#shared/lib/db/guest-conversations.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('guest conversation read ownership', () => {
	it('ignores a previous conversation read after navigation', async () => {
		const pending = new Map<string, (value: GuestConversationWithMessages | null) => void>()
		const actor = createActor(guestConversationMachine.provide({ actors: {
			load: createAsyncLogic<GuestConversationRead, string>({ run: async ({ input }) => ({ conversation: await new Promise<GuestConversationWithMessages | null>((resolve) => pending.set(input, resolve)) }) })
		} })).start()
		actor.send({ type: 'LOAD', id: 'old' })
		actor.send({ type: 'LOAD', id: 'new' })
		pending.get('new')!(null)
		await tick()
		pending.get('old')!({ conversation: { id: 'old' }, messages: [] } as unknown as GuestConversationWithMessages)
		await tick()
		expect(actor.getSnapshot().context).toEqual({ id: 'new', conversation: null })
		expect(actor.getSnapshot().matches('loaded')).toBe(true)
		actor.stop()
	})
	it('distinguishes storage failure from an absent conversation and allows retry', async () => {
		let attempts = 0
		const actor = createActor(guestConversationMachine.provide({ actors: {
			load: createAsyncLogic<GuestConversationRead, string>({ run: async () => {
				if (++attempts === 1) throw new Error('Storage unavailable')
				return { conversation: null }
			} })
		} })).start()
		actor.send({ type: 'LOAD', id: 'conversation' }); await tick()
		expect(actor.getSnapshot().matches('failed')).toBe(true)
		actor.send({ type: 'LOAD', id: 'conversation' }); await tick()
		expect(actor.getSnapshot().matches('loaded')).toBe(true)
		actor.stop()
	})
})
