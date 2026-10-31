import { setup, types, type SnapshotFrom } from 'xstate'

/** One browser attempt. Durable turn/claim authority remains in the server/store. */
export const turnLifecycleMachine = setup({
	schemas: {
		events: {
			THINK: types<{}>(), PERSIST: types<{}>(), FINISH: types<{}>(),
			SAVED: types<{}>(), FAIL: types<{}>(), SAVE_FAILED: types<{}>(),
			BEGIN_STOP: types<{}>(), REJECT_STOP: types<{}>(), STOP: types<{}>(),
			DETACH: types<{}>(), CANCEL: types<{}>()
		}
	}
}).createMachine({
	id: 'browserTurn',
	initial: 'running',
	on: { DETACH: { target: '.detached' }, CANCEL: { target: '.cancelled' } },
	states: {
		running: {
			initial: 'preparing',
			on: { FAIL: { target: '#browserTurnFailed' }, FINISH: { target: '#browserTurnSaving' } },
			states: {
				history: { id: 'browserTurnHistory', type: 'history', target: 'preparing' },
				preparing: {
					on: { THINK: { target: 'thinking' }, PERSIST: { target: 'persisting' }, BEGIN_STOP: { target: '#browserTurnStopping' }, STOP: { target: '#browserTurnFailed' } }
				},
				thinking: {
					on: { PERSIST: { target: 'persisting' }, BEGIN_STOP: { target: '#browserTurnStopping' }, STOP: { target: '#browserTurnFailed' } }
				},
				persisting: {}
			}
		},
		stopping: { id: 'browserTurnStopping', on: { REJECT_STOP: { target: '#browserTurnHistory' }, STOP: { target: 'failed' } } },
		saving: { id: 'browserTurnSaving', on: { SAVED: { target: 'completed' }, SAVE_FAILED: { target: 'failed' } } },
		completed: {},
		failed: { id: 'browserTurnFailed' },
		detached: {},
		cancelled: {}
	}
})

export type TurnLifecycleSnapshot = SnapshotFrom<typeof turnLifecycleMachine>
export type RequestPhase = 'idle' | 'preparing' | 'thinking' | 'persisting' | 'error'

export function requestPhaseFor(snapshot: TurnLifecycleSnapshot | null): RequestPhase {
	if (!snapshot) return 'idle'
	if (snapshot.matches({ running: 'preparing' })) return 'preparing'
	if (snapshot.matches({ running: 'thinking' }) || snapshot.matches('stopping')) return 'thinking'
	if (snapshot.matches({ running: 'persisting' }) || snapshot.matches('saving')) return 'persisting'
	if (snapshot.matches('failed')) return 'error'
	return 'idle'
}
