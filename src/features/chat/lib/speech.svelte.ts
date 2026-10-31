import { useMachine } from '@xstate/svelte'
import { speechMachine, type SpeechFailure } from './speech.machine.ts'
import { createSpeechRecognition, ensureOnDeviceLanguagePack, getRecognitionMode } from '#features/chat/lib/speech-recognition.ts'

/** The composer and landing page share the same cancellable dictation lifecycle. */
export function useSpeech(options: {
	getLanguage: () => string
	getText: () => string
	onTranscript: (text: string) => void
	onFailure: (failure: SpeechFailure) => void
	isDisabled?: () => boolean
}) {
	const { snapshot, send, actorRef } = useMachine(speechMachine, {
		input: {
			createRecognition: createSpeechRecognition,
			prepareLanguage: ensureOnDeviceLanguagePack,
			onTranscript: options.onTranscript,
			onFailure: options.onFailure
		}
	})
	$effect(() => {
		send({ type: 'INITIALIZE', mode: getRecognitionMode() })
		// useMachine stops the actor and releases its recognizer on component destruction.
	})
	$effect(() => {
		if (options.isDisabled?.()) send({ type: 'CANCEL' })
	})
	return {
		snapshot,
		cancel: () => send({ type: 'CANCEL' }),
		toggle: () => {
			if (options.isDisabled?.()) return
			const start = { type: 'START' as const, lang: options.getLanguage(), base: options.getText() }
			if (actorRef.getSnapshot().can(start)) send(start)
			else send({ type: 'STOP' })
		}
	}
}
