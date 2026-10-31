import { createAsyncLogic, setup, types } from 'xstate'

export const MAX_OUTBOX_ATTEMPTS = 6
type Attempt = {
	attemptCount: number
	alreadyPersisted: boolean
	persist: () => Promise<unknown>
	acknowledge: () => Promise<void>
	cleanup: () => Promise<void>
}
type Outcome = 'persisted' | 'retry_wait' | 'failed' | 'receipt_unconfirmed' | 'cleanup_pending'

/** A local cleanup failure can never become a failed remote write. */
export const outboxAttemptMachine = setup({
	schemas: {
		input: types<Attempt>(),
		context: types<Attempt & { error: unknown; outcome: Outcome }>(),
		output: types<{ outcome: Outcome; error: unknown; attemptCount: number }>()
	},
	actors: { work: createAsyncLogic<unknown, () => Promise<unknown>>({ run: ({ input }) => input() }) }
}).createMachine({
	id: 'outboxAttempt',
	context: ({ input }) => ({ ...input, error: null, outcome: 'persisted' }),
	initial: 'restoring',
	output: ({ context }) => ({ outcome: context.outcome, error: context.error, attemptCount: context.attemptCount }),
	states: {
		restoring: { always: ({ context }) => ({ target: context.alreadyPersisted ? 'cleaning' : 'persisting' }) },
		persisting: {
			invoke: {
				src: 'work', input: ({ context }) => context.persist,
				onDone: { target: 'acknowledging' },
				onError: ({ context, event }) => ({ target: 'done', context: {
					error: event.error, attemptCount: context.attemptCount + 1,
					outcome: context.attemptCount + 1 >= MAX_OUTBOX_ATTEMPTS ? 'failed' : 'retry_wait'
				} })
			}
		},
		acknowledging: {
			invoke: {
				src: 'work', input: ({ context }) => context.acknowledge,
				onDone: { target: 'cleaning' },
				onError: ({ event }) => ({ target: 'done', context: { outcome: 'receipt_unconfirmed', error: event.error } })
			}
		},
		cleaning: {
			invoke: {
				src: 'work', input: ({ context }) => context.cleanup,
				onDone: { target: 'done' },
				onError: ({ event }) => ({ target: 'done', context: { outcome: 'cleanup_pending', error: event.error } })
			}
		},
		done: { type: 'final' }
	}
})
