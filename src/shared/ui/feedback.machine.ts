import { createAsyncLogic, setup, types } from 'xstate'

export function createFeedbackMachine(deps: {
	submit: (message: string, signal: AbortSignal) => Promise<void>
	close: () => void
	submitted: () => void
}) {
	return setup({
		schemas: {
			context: types<{ message: string; error: string | null }>(),
			events: {
				OPEN: types<{}>(),
				CLOSE: types<{}>(),
				EDIT: types<{ message: string }>(),
				SUBMIT: types<{}>()
			}
		},
		actors: {
			submit: createAsyncLogic<void, string>({
				run: ({ input, signal }) => deps.submit(input, signal)
			})
		}
	}).createMachine({
		id: 'feedback',
		context: { message: '', error: null },
		initial: 'closed',
		on: { CLOSE: { target: '.closing' } },
		states: {
			closed: { on: { OPEN: { target: 'editing' } } },
			closing: {
				after: { 200: () => ({ target: 'closed', context: { message: '', error: null } }) },
				on: { OPEN: () => ({ target: 'editing', context: { message: '', error: null } }) }
			},
			editing: {
				on: {
					EDIT: ({ event }) => ({ context: { message: event.message, error: null } }),
					SUBMIT: ({ context }) => {
						if (context.message.trim()) return { target: 'submitting', context: { error: null } }
					}
				}
			},
			submitting: {
				invoke: {
					src: 'submit',
					input: ({ context }) => context.message,
					onDone: (_, enq) => {
						enq(deps.submitted)
						return { target: 'submitted' }
					},
					onError: () => ({
						target: 'editing',
						context: { error: 'Feedback submission failed. Please try again.' }
					})
				}
			},
			submitted: {
				after: {
					2000: (_, enq) => {
						enq(deps.close)
						return { target: 'closing' }
					}
				}
			}
		}
	})
}
