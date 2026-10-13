<script lang="ts">
	import { Mic, Send, Square } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { toast } from 'svelte-sonner'
	import { getLocale } from '#paraglide/runtime.js'
	import {
		createSpeechRecognition,
		ensureOnDeviceLanguagePack,
		getRecognitionMode,
		type RecognitionMode,
		type SpeechRecognitionLike
	} from '#features/chat/lib/speech-recognition.ts'

	let {
		onSend,
		onStop,
		canStop = false,
		disabled = false,
		emphasized = false
	}: {
		onSend: (message: string) => void
		onStop?: () => void
		canStop?: boolean
		disabled?: boolean
		emphasized?: boolean
	} = $props()

	let value = $state('')
	let isFocused = $state(false)

	let textareaRef = $state<HTMLTextAreaElement | null>(null)

	// Speech-to-text via the browser Web Speech API. Resolved after mount so SSR
	// and client renders agree (avoids hydration mismatch); `mode` is a browser
	// capability and never changes for the lifetime of the component.
	let isSupported = $state(false)
	let modeRef: RecognitionMode = 'cloud'
	let isListening = $state(false)
	let recognitionRef: SpeechRecognitionLike | null = null
	let baseValueRef = ''
	let committedTranscriptRef = ''

	const getRecognitionLang = () => (getLocale() === 'es' ? 'es-AR' : 'en-US')

	function startRecognition(recognition: SpeechRecognitionLike, base: string) {
		recognitionRef = recognition
		baseValueRef = base
		committedTranscriptRef = ''

		recognition.onresult = (event) => {
			let interim = ''
			let committed = committedTranscriptRef
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i]
				if (result.isFinal) {
					committed += result[0].transcript
				} else {
					interim += result[0].transcript
				}
			}
			committedTranscriptRef = committed
			value = [baseValueRef, committed, interim].filter(Boolean).join(' ')
		}

		recognition.onerror = (event) => {
			if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
				toast.error(m.chat_dictate_permission())
			} else if (event.error === 'language-not-supported') {
				// On-device pack missing at runtime — transparently retry via cloud.
				recognition.abort()
				const fallback = createSpeechRecognition(getRecognitionLang(), 'cloud')
				if (fallback) startRecognition(fallback, baseValueRef)
			}
		}

		recognition.onend = () => {
			isListening = false
			if (recognitionRef === recognition) recognitionRef = null
		}

		recognition.start()
		isListening = true
	}

	async function handleMicClick() {
		if (disabled || !isSupported) return
		if (isListening) {
			recognitionRef?.stop()
			return
		}

		const lang = getRecognitionLang()
		const mode = modeRef
		let effectiveMode: RecognitionMode = mode

		if (mode === 'on-device') {
			const { ok, fallbackToCloud } = await ensureOnDeviceLanguagePack(lang)
			if (!ok && !fallbackToCloud) {
				toast.error(m.chat_dictate_install_error())
				return
			}
			effectiveMode = ok ? 'on-device' : 'cloud'
		}

		const recognition = createSpeechRecognition(lang, effectiveMode)
		if (recognition) startRecognition(recognition, value)
	}

	function handleSubmit() {
		if (value.trim() && !disabled) {
			onSend(value.trim())
			value = ''
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		// Enter to send, Shift+Enter for newline
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault()
			handleSubmit()
		}
	}

	const canSubmit = $derived(value.trim().length > 0 && !disabled)

	// `autocorrect` is a non-standard (but widely supported on mobile) textarea
	// attribute that Svelte's HTML element types do not include.
	const autocorrectAttrs: Record<string, string> = { autocorrect: 'on' }

	// Resolve recognition mode once after mount.
	$effect(() => {
		const mode = getRecognitionMode()
		modeRef = mode
		isSupported = mode !== 'unsupported'
	})

	// Stop recognition if the input is disabled mid-dictation.
	$effect(() => {
		if (disabled && isListening) recognitionRef?.abort()
	})

	// Abort on unmount.
	$effect(() => {
		return () => {
			recognitionRef?.abort()
		}
	})

	// Refocus when re-enabled.
	$effect(() => {
		if (!disabled && textareaRef) {
			textareaRef.focus()
		}
	})
</script>

<div class="relative">
	<!-- No <form> wrapper - prevents Chrome autofill bar on mobile -->
	<div class="relative px-4 pb-4 pt-2 sm:px-8 sm:pb-5 bg-background">
		<div class="max-w-[860px] mx-auto">
			{#if emphasized}
				<p class="mb-1.5 px-1 text-sm font-medium text-foreground">{m.home_composer_label()}</p>
			{/if}
			<div
				class="relative flex items-end gap-3 rounded-2xl border bg-card transition-[border-color,box-shadow] duration-200 {isFocused
					? 'border-primary/50 ring-2 ring-primary/10'
					: emphasized
						? 'border-primary/30'
						: 'border-border/50'} {disabled ? 'opacity-60' : ''}"
			>
				<!-- Auto-growing textarea wrapper using CSS grid trick -->
				<div
					class="flex-1 grid min-h-[46px] after:content-[attr(data-replicated-value)_'_'] after:whitespace-pre-wrap after:invisible after:col-start-1 after:col-end-2 after:row-start-1 after:row-end-2 after:py-3 after:px-4 after:text-base after:sm:text-sm after:leading-normal after:font-[inherit] after:border after:border-transparent"
					data-replicated-value={value}
				>
					<textarea
						bind:this={textareaRef}
						bind:value={value}
						{...autocorrectAttrs}
						onkeydown={handleKeyDown}
						onfocus={() => (isFocused = true)}
						onblur={() => (isFocused = false)}
						placeholder={m.chat_placeholder()}
						{disabled}
						rows={1}
						autocomplete="off"
						autocapitalize="sentences"
						spellcheck
						data-form-type="other"
						data-lpignore="true"
						data-1p-ignore="true"
						aria-autocomplete="none"
						aria-label={m.chat_input_label()}
						class="col-start-1 col-end-2 row-start-1 row-end-2 resize-none overflow-y-auto max-h-40 min-h-[46px] bg-transparent px-4 py-3 text-base sm:text-sm text-foreground leading-normal placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed"
					></textarea>
				</div>

				<button
					type="button"
					onclick={handleMicClick}
					disabled={disabled || !isSupported}
					aria-label={isListening ? m.chat_stop_dictating() : m.chat_dictate()}
					aria-pressed={isListening}
					title={!isSupported ? m.chat_dictate_unsupported() : undefined}
					class="mb-0.5 size-11 rounded-full shrink-0 transition-colors duration-200 flex items-center justify-center {!isSupported
						? 'text-muted-foreground/40 cursor-not-allowed'
						: 'text-muted-foreground hover:text-primary hover:bg-primary/10'} {isListening
						? 'text-red-500 bg-red-500/15 hover:bg-red-500/25 animate-pulse'
						: ''}"
				>
					<Mic class="h-4 w-4" />
					<span class="sr-only">
						{isListening ? m.chat_stop_dictating() : m.chat_dictate()}
					</span>
				</button>

				{#if canStop && onStop}
					<button
						type="button"
						onclick={onStop}
						aria-label={m.chat_stop_response()}
						class="mr-0.5 mb-0.5 size-11 rounded-full shrink-0 flex items-center justify-center bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Square class="h-4 w-4" aria-hidden="true" />
					</button>
				{:else}
					<button
						type="button"
						onclick={handleSubmit}
						disabled={!canSubmit}
						class="mr-0.5 mb-0.5 size-11 rounded-full shrink-0 flex items-center justify-center transition-colors duration-200 {canSubmit
							? 'bg-primary text-primary-foreground hover:bg-primary/90'
							: 'bg-muted text-muted-foreground cursor-not-allowed'}"
					>
						<Send class="h-4 w-4" />
						<span class="sr-only">{m.chat_send()}</span>
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
