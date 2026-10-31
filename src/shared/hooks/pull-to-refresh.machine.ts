import { createAsyncLogic, setup, types } from 'xstate'

interface PullContext {
	startY: number
	distance: number
	threshold: number
	maxPull: number
	onRefresh: () => void | Promise<void>
}

export function resistedPull(distance: number, maxPull: number): number {
	return maxPull * (1 - Math.exp((-0.4 * Math.max(0, distance)) / maxPull))
}

export const pullToRefreshMachine = setup({
	schemas: {
		context: types<PullContext>(),
		input: types<Pick<PullContext, 'threshold' | 'maxPull' | 'onRefresh'>>(),
		events: {
			START: types<{ y: number }>(), MOVE: types<{ y: number }>(),
			END: types<{}>(), CANCEL: types<{}>()
		}
	},
	actors: { refresh: createAsyncLogic({
		schemas: { input: types<PullContext>() },
		run: async ({ input }) => { await input.onRefresh() }
	}) }
}).createMachine({
	id: 'pullToRefresh',
	context: ({ input }) => ({ ...input, startY: 0, distance: 0 }),
	initial: 'idle',
	// Every browser touch ends, including gestures the attachment never claimed.
	on: { CANCEL: {}, END: {} },
	states: {
		idle: {
			entry: () => ({ context: { startY: 0, distance: 0 } }),
			on: { START: ({ event }) => ({ target: 'tracking', context: { startY: event.y } }) }
		},
		tracking: {
			initial: 'pulling',
			on: {
				MOVE: ({ context, event }) => {
					const distance = resistedPull(event.y - context.startY, context.maxPull)
					return { target: distance >= context.threshold ? '.armed' : '.pulling', context: { distance } }
				},
				CANCEL: { target: 'idle' }
			},
			states: {
				pulling: { on: { END: { target: '#pullToRefresh.idle' } } },
				armed: { on: { END: { target: '#pullToRefresh.refreshing' } } }
			}
		},
		refreshing: {
			invoke: {
				src: 'refresh', input: ({ context }) => context,
				onDone: { target: 'idle' },
				onError: ({ event }, enq) => {
					enq(() => console.error('Pull-to-refresh failed:', event.error))
					return { target: 'failed' }
				}
			}
		},
		failed: {
			entry: () => ({ context: { startY: 0, distance: 0 } }),
			on: { START: ({ event }) => ({ target: 'tracking', context: { startY: event.y } }) }
		}
	}
})
