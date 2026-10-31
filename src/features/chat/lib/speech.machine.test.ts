import { describe, expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, waitFor } from 'xstate'
import { speechMachine } from './speech.machine.ts'
import type { LanguagePackResult, SpeechRecognitionLike } from './speech-recognition.ts'

function recognizer(): SpeechRecognitionLike {
	return { lang: '', continuous: false, interimResults: true, maxAlternatives: 1, start: vi.fn(), stop: vi.fn(), abort: vi.fn(), onresult: null, onerror: null, onend: null }
}
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => { resolve = done })
	return { promise, resolve }
}
function fixture(options: { prepareLanguage?: () => Promise<LanguagePackResult>; recognizers?: SpeechRecognitionLike[] } = {}) {
	const queue = options.recognizers ?? [recognizer()]
	const createRecognition = vi.fn(() => queue.shift() ?? null)
	const onTranscript = vi.fn()
	const onFailure = vi.fn()
	const actor = createActor(speechMachine, { input: {
		createRecognition, onTranscript, onFailure,
		prepareLanguage: options.prepareLanguage ?? (() => Promise.resolve({ ok: true, fallbackToCloud: false }))
	} }).start()
	return { actor, createRecognition, onTranscript, onFailure }
}
const start = { type: 'START' as const, lang: 'es-AR', base: 'Tonight' }

describe('dictation ownership', () => {
	it('cancels pending preparation and ignores its late completion', async () => {
		const pack = deferred<LanguagePackResult>()
		const f = fixture({ prepareLanguage: () => pack.promise })
		f.actor.send({ type: 'INITIALIZE', mode: 'on-device' })
		f.actor.send(start)
		f.actor.send(start)
		expect(f.actor.getSnapshot().value).toBe('preparing')
		f.actor.send({ type: 'CANCEL' })
		pack.resolve({ ok: true, fallbackToCloud: false })
		await Promise.resolve()
		await Promise.resolve()
		expect(f.actor.getSnapshot().value).toBe('idle')
		expect(f.createRecognition).not.toHaveBeenCalled()
		f.actor.stop()
	})

	it('does not start speech after component actor cleanup during preparation', async () => {
		const pack = deferred<LanguagePackResult>()
		const f = fixture({ prepareLanguage: () => pack.promise })
		f.actor.send({ type: 'INITIALIZE', mode: 'on-device' })
		f.actor.send(start)
		f.actor.stop()
		pack.resolve({ ok: true, fallbackToCloud: false })
		await Promise.resolve()
		await Promise.resolve()
		expect(f.createRecognition).not.toHaveBeenCalled()
	})

	it('invalidates fallback recognizer callbacks before starting the replacement', async () => {
		const local = recognizer()
		const cloud = recognizer()
		const f = fixture({ recognizers: [local, cloud] })
		f.actor.send({ type: 'INITIALIZE', mode: 'on-device' })
		f.actor.send(start)
		await waitFor(f.actor, (s) => s.matches('recognizing'))
		const staleEnd = local.onend!
		const staleResult = local.onresult!
		local.onerror!({ error: 'language-not-supported' })
		expect(f.createRecognition).toHaveBeenLastCalledWith('es-AR', 'cloud')
		staleEnd()
		staleResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'stale' } }] })
		expect(f.actor.getSnapshot().matches({ recognizing: 'listening' })).toBe(true)
		expect(f.onTranscript).not.toHaveBeenCalled()
		cloud.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'jazz' } }] })
		expect(f.onTranscript).toHaveBeenLastCalledWith('Tonight jazz')
		f.actor.stop()
	})

	it('owns final results while stopping and blocks a second start until end', async () => {
		const recognition = recognizer()
		const f = fixture({ recognizers: [recognition] })
		f.actor.send({ type: 'INITIALIZE', mode: 'cloud' })
		f.actor.send(start)
		await waitFor(f.actor, (s) => s.matches('recognizing'))
		f.actor.send({ type: 'STOP' })
		f.actor.send(start)
		expect(recognition.stop).toHaveBeenCalledOnce()
		expect(f.createRecognition).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().matches({ recognizing: 'stopping' })).toBe(true)
		recognition.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'jazz' } }] })
		recognition.onend!()
		expect(f.onTranscript).toHaveBeenCalledWith('Tonight jazz')
		expect(f.actor.getSnapshot().value).toBe('idle')
		f.actor.stop()
	})

	it('releases a stopped recognizer when the browser never emits end', async () => {
		const recognition = recognizer()
		const clock = new SimulatedClock()
		const actor = createActor(speechMachine, { clock, input: {
			createRecognition: () => recognition,
			prepareLanguage: async () => ({ ok: true, fallbackToCloud: false }),
			onTranscript: vi.fn(), onFailure: vi.fn()
		} }).start()
		actor.send({ type: 'INITIALIZE', mode: 'cloud' })
		actor.send(start)
		await waitFor(actor, (s) => s.matches('recognizing'))
		actor.send({ type: 'STOP' })
		clock.increment(2000)
		expect(actor.getSnapshot().value).toBe('idle')
		expect(recognition.abort).toHaveBeenCalledOnce()
		actor.stop()
	})

	it('reports permission failure once and does not fallback on denied permission', async () => {
		const recognition = recognizer()
		const f = fixture({ recognizers: [recognition] })
		f.actor.send({ type: 'INITIALIZE', mode: 'cloud' })
		f.actor.send(start)
		await waitFor(f.actor, (s) => s.matches('recognizing'))
		const staleError = recognition.onerror!
		staleError({ error: 'not-allowed' })
		staleError({ error: 'not-allowed' })
		expect(f.actor.getSnapshot().value).toBe('failed')
		expect(f.onFailure).toHaveBeenCalledOnce()
		expect(f.onFailure).toHaveBeenCalledWith('permission')
		expect(f.createRecognition).toHaveBeenCalledOnce()
		f.actor.stop()
	})

	it('releases the recognizer on disposal and ignores late text', async () => {
		const recognition = recognizer()
		const f = fixture({ recognizers: [recognition] })
		f.actor.send({ type: 'INITIALIZE', mode: 'cloud' })
		f.actor.send(start)
		await waitFor(f.actor, (s) => s.matches('recognizing'))
		const staleResult = recognition.onresult!
		f.actor.send({ type: 'DISPOSE' })
		staleResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] })
		expect(recognition.abort).toHaveBeenCalledOnce()
		expect(f.onTranscript).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().status).toBe('done')
	})
})
