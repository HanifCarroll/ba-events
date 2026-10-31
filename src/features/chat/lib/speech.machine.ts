import { createAsyncLogic, createCallbackLogic, setup, types } from 'xstate'
import type { LanguagePackResult, RecognitionMode, SpeechRecognitionLike } from './speech-recognition.ts'

export type SpeechFailure = 'permission' | 'language-pack' | 'recognition'

interface SpeechInput {
	createRecognition: (lang: string, mode: RecognitionMode) => SpeechRecognitionLike | null
	prepareLanguage: (lang: string) => Promise<LanguagePackResult>
	onTranscript: (text: string) => void
	onFailure: (failure: SpeechFailure) => void
}

interface SpeechContext extends SpeechInput {
	mode: RecognitionMode
	effectiveMode: RecognitionMode
	lang: string
	base: string
}

/** Each invocation owns its recognizer; exiting it invalidates every callback. */
export const speechMachine = setup({
	schemas: {
		context: types<SpeechContext>(),
		input: types<SpeechInput>(),
		events: {
			INITIALIZE: types<{ mode: RecognitionMode }>(),
			START: types<{ lang: string; base: string }>(),
			STOP: types<{}>(), CANCEL: types<{}>(), DISPOSE: types<{}>(),
			ENDED: types<{}>(), LANGUAGE_UNSUPPORTED: types<{}>(),
			FAILED: types<{ failure: SpeechFailure }>()
		}
	},
	actors: {
		prepare: createAsyncLogic({
			schemas: { input: types<Pick<SpeechContext, 'mode' | 'lang' | 'prepareLanguage'>>() },
			run: async ({ input }) => {
				if (input.mode !== 'on-device') return input.mode
				const result = await input.prepareLanguage(input.lang)
				if (result.ok) return 'on-device' as const
				if (result.fallbackToCloud) return 'cloud' as const
				throw new Error('Language pack unavailable')
			}
		}),
		recognize: createCallbackLogic<{ type: 'STOP' }, SpeechContext>(({ input, sendBack, receive }) => {
			let recognition: SpeechRecognitionLike | null
			try { recognition = input.createRecognition(input.lang, input.effectiveMode) } catch {
				sendBack({ type: 'FAILED', failure: 'recognition' })
				return
			}
			if (!recognition) {
				sendBack({ type: 'FAILED', failure: 'recognition' })
				return
			}
			let live = true
			let committed = ''
			recognition.onresult = (event) => {
				if (!live) return
				let interim = ''
				for (let i = event.resultIndex; i < event.results.length; i++) {
					const result = event.results[i]
					if (result.isFinal) committed += result[0].transcript
					else interim += result[0].transcript
				}
				input.onTranscript([input.base, committed, interim].filter(Boolean).join(' '))
			}
			recognition.onerror = ({ error }) => {
				if (!live) return
				if (error === 'language-not-supported') sendBack({ type: 'LANGUAGE_UNSUPPORTED' })
				else if (error === 'not-allowed' || error === 'service-not-allowed') {
					sendBack({ type: 'FAILED', failure: 'permission' })
				} else sendBack({ type: 'FAILED', failure: 'recognition' })
			}
			recognition.onend = () => { if (live) sendBack({ type: 'ENDED' }) }
			receive(() => {
				try { recognition.stop() } catch { sendBack({ type: 'ENDED' }) }
			})
			try { recognition.start() } catch { sendBack({ type: 'FAILED', failure: 'recognition' }) }
			return () => {
				live = false
				recognition.onresult = null
				recognition.onerror = null
				recognition.onend = null
				try { recognition.abort() } catch { /* Some browsers throw after an ended session. */ }
			}
		})
	}
}).createMachine({
	id: 'speech',
	context: ({ input }) => ({ ...input, mode: 'unsupported', effectiveMode: 'unsupported', lang: '', base: '' }),
	initial: 'uninitialized',
	// Cancellation is idempotent before initialization and while already idle.
	on: { DISPOSE: { target: '.disposed' }, CANCEL: {} },
	states: {
		uninitialized: {
			on: { INITIALIZE: ({ event }) => event.mode === 'unsupported'
				? { target: 'unsupported' }
				: { target: 'idle', context: { mode: event.mode } }
			}
		},
		unsupported: {},
		idle: { on: { START: ({ event }) => ({ target: 'preparing', context: { lang: event.lang, base: event.base } }) } },
		preparing: {
			invoke: {
				src: 'prepare', input: ({ context }) => context,
				onDone: ({ event }) => ({ target: 'recognizing', context: { effectiveMode: event.output } }),
				onError: ({ context }, enq) => {
					enq(context.onFailure, 'language-pack')
					return { target: 'failed' }
				}
			},
			on: { CANCEL: { target: 'idle' }, STOP: { target: 'idle' } }
		},
		recognizing: {
			invoke: { id: 'recognizer', src: 'recognize', input: ({ context }) => context },
			initial: 'listening',
			states: {
				listening: { on: { STOP: (_, enq) => {
					enq.sendTo('recognizer', { type: 'STOP' })
					return { target: 'stopping' }
				} } },
				// Browsers may omit onend after stop; release the session after a bounded final-result window.
				stopping: { after: { 2000: { target: '#speech.idle' } }, on: { LANGUAGE_UNSUPPORTED: { target: '#speech.idle' } } }
			},
			on: {
				CANCEL: { target: 'idle' }, ENDED: { target: 'idle' },
				FAILED: ({ context, event }, enq) => {
					enq(context.onFailure, event.failure)
					return { target: 'failed' }
				},
				LANGUAGE_UNSUPPORTED: ({ context }, enq) => {
					if (context.effectiveMode === 'on-device') {
						return { target: 'recognizing', reenter: true, context: { effectiveMode: 'cloud' } }
					}
					enq(context.onFailure, 'language-pack')
					return { target: 'failed' }
				}
			}
		},
		failed: { on: {
			START: ({ event }) => ({ target: 'preparing', context: { lang: event.lang, base: event.base } }),
			CANCEL: { target: 'idle' }
		} },
		disposed: { type: 'final' }
	}
})
