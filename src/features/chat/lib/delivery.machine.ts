import { setup, types } from 'xstate'

/** Transport recovery only: it never retries generation or acquires a new claim. */
export const deliveryMachine = setup({
	schemas: {
		context: types<{ failures: number; offset: number; cancelledBy: 'consumer' | 'signal' | null }>(),
		events: {
			CONNECTED: types<{}>(), PASSTHROUGH: types<{}>(), LOST: types<{}>(), RETRY: types<{}>(),
			CANCEL: types<{ by: 'consumer' | 'signal' }>(),
			FRAME: types<{ offset: number; finished: boolean }>()
		}
	}
}).createMachine({
	id: 'delivery',
	initial: 'connecting',
	context: { failures: 0, offset: -1, cancelledBy: null },
	on: { CANCEL: ({ event }) => ({ target: '.cancelled', context: { cancelledBy: event.by } }) },
	states: {
		connecting: {
			on: {
				CONNECTED: { target: 'streaming' }, PASSTHROUGH: { target: 'completed' },
				LOST: ({ context }) => context.failures >= 5 ? { target: 'failed' }
					: { target: 'connection_wait', context: { failures: context.failures + 1 } }
			}
		},
		connection_wait: { on: { RETRY: { target: 'connecting' } } },
		streaming: {
			on: {
				FRAME: ({ context, event }) => {
					if (event.offset !== context.offset + 1) return
					return { ...(event.finished ? { target: 'completed' } : {}), context: { offset: event.offset, failures: 0 } }
				},
				LOST: ({ context }) => context.failures >= 5 ? { target: 'failed' }
					: { target: 'reconnect_wait', context: { failures: context.failures + 1 } }
			}
		},
		reconnect_wait: { on: { RETRY: { target: 'reconnecting' } } },
		reconnecting: {
			on: {
				CONNECTED: { target: 'streaming' },
				LOST: ({ context }) => context.failures >= 5 ? { target: 'failed' }
					: { target: 'reconnect_wait', context: { failures: context.failures + 1 } }
			}
		},
		completed: { type: 'final' },
		failed: { type: 'final' },
		cancelled: { type: 'final' }
	}
})
