import { describe, expect, it } from 'vitest'
import { createActor, SimulatedClock, waitFor } from 'xstate'
import { createFeedbackMachine } from './feedback.machine.ts'

describe('feedback lifecycle', () => {
	it('ignores a dismissed submission and keeps a reopened draft', async () => {
		let resolve!: () => void
		let submissions = 0
		let signal: AbortSignal | undefined
		const clock = new SimulatedClock()
		const actor = createActor(
			createFeedbackMachine({
				submit: (_message, abort) => {
					signal = abort
					return new Promise<void>((done) => {
						resolve = done
					})
				},
				close: () => {},
				submitted: () => {
					submissions++
				}
			}),
			{ clock }
		).start()
		actor.send({ type: 'OPEN' })
		actor.send({ type: 'EDIT', message: 'old' })
		actor.send({ type: 'SUBMIT' })
		actor.send({ type: 'CLOSE' })
		actor.send({ type: 'OPEN' })
		actor.send({ type: 'EDIT', message: 'new' })
		expect(signal?.aborted).toBe(true)
		resolve()
		await Promise.resolve()
		await Promise.resolve()
		clock.increment(5000)
		expect(submissions).toBe(0)
		expect(actor.getSnapshot().context.message).toBe('new')
		expect(actor.getSnapshot().matches('editing')).toBe(true)
		actor.stop()
	})
	it('auto-closes a successful submission once and clears the draft after closing', async () => {
		const clock = new SimulatedClock()
		let closes = 0
		const actor = createActor(
			createFeedbackMachine({
				submit: async () => {},
				close: () => {
					closes++
				},
				submitted: () => {}
			}),
			{ clock }
		).start()
		actor.send({ type: 'OPEN' })
		actor.send({ type: 'EDIT', message: 'synthetic feedback' })
		actor.send({ type: 'SUBMIT' })
		await waitFor(actor, (s) => s.matches('submitted'))
		clock.increment(2000)
		expect(closes).toBe(1)
		clock.increment(200)
		expect(actor.getSnapshot().matches('closed')).toBe(true)
		expect(actor.getSnapshot().context.message).toBe('')
		actor.stop()
	})
})
