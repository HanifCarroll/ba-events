import { createActor, createAsyncLogic, setup, types, waitFor } from 'xstate'
import type { BeforeInstallPromptEvent } from './install.ts'

export const installMachine = setup({
	schemas: {
		context: types<{ isIos: boolean; prompt: BeforeInstallPromptEvent | null }>(),
		events: {
			INITIALIZE: types<{ isIos: boolean; installed: boolean }>(),
			AVAILABLE: types<{ prompt: BeforeInstallPromptEvent }>(),
			PROMPT: types<{}>(), INSTALLED: types<{}>()
		}
	},
	actors: {
		prompt: createAsyncLogic({
			schemas: { input: types<BeforeInstallPromptEvent>() },
			run: async ({ input }) => {
				const [, choice] = await Promise.all([input.prompt(), input.userChoice])
				return choice.outcome
			}
		})
	}
}).createMachine({
	id: 'install',
	context: { isIos: false, prompt: null },
	initial: 'uninitialized',
	on: {
		INSTALLED: { target: '.installed' },
		AVAILABLE: ({ event }) => ({ target: '.available', context: { prompt: event.prompt } })
	},
	states: {
		uninitialized: { on: { INITIALIZE: ({ event }) => ({
			target: event.installed ? 'installed' : 'waiting', context: { isIos: event.isIos }
		}) } },
		waiting: {},
		available: { on: { PROMPT: { target: 'prompting' } } },
		prompting: {
			on: { AVAILABLE: {} },
			invoke: {
				src: 'prompt', input: ({ context }) => context.prompt!,
				onDone: ({ event }) => ({ target: event.output === 'accepted' ? 'accepted_waiting' : 'dismissed' }),
				onError: { target: 'failed' }
			}
		},
		accepted_waiting: { entry: () => ({ context: { prompt: null } }) },
		dismissed: { entry: () => ({ context: { prompt: null } }) },
		failed: { entry: () => ({ context: { prompt: null } }) },
		installed: { type: 'final', entry: () => ({ context: { prompt: null } }) }
	}
})

export function createInstallController() {
	const actor = createActor(installMachine)
	return {
		actor,
		async prompt() {
			if (!actor.getSnapshot().can({ type: 'PROMPT' })) return
			actor.send({ type: 'PROMPT' })
			await waitFor(actor, (state) => !state.matches('prompting'))
		}
	}
}
