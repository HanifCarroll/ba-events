import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, Send } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { toast } from 'sonner'
import { getLocale } from '@/paraglide/runtime'
import {
  createSpeechRecognition,
  ensureOnDeviceLanguagePack,
  getRecognitionMode,
  type RecognitionMode,
  type SpeechRecognitionLike,
} from '@/features/chat/lib/speech-recognition'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  emphasized?: boolean
}

/**
 * Chat input with auto-growing textarea.
 *
 * UX best practices applied:
 * - Textarea instead of input (standard for chat apps like ChatGPT, Slack, Discord)
 * - Auto-grow using CSS grid trick (content replicated in ::after pseudo-element)
 * - Max height with scroll to prevent excessive growth
 * - Enter to send, Shift+Enter for newline (universal chat pattern)
 * - Mobile-friendly with proper touch targets
 * - No <form> wrapper to prevent Chrome autofill suggestions
 *
 * @see https://css-tricks.com/the-cleanest-trick-for-autogrowing-textareas/
 */
export function ChatInput({
  onSend,
  disabled = false,
  emphasized = false,
}: ChatInputProps) {
  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Speech-to-text via the browser Web Speech API. Resolved after mount so SSR
  // and client renders agree (avoids hydration mismatch); `mode` is a browser
  // capability and never changes for the lifetime of the component.
  const [isSupported, setIsSupported] = useState(false)
  const modeRef = useRef<RecognitionMode>('cloud')
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseValueRef = useRef('')
  const committedTranscriptRef = useRef('')

  useEffect(() => {
    const mode = getRecognitionMode()
    modeRef.current = mode
    setIsSupported(mode !== 'unsupported')
  }, [])

  // Language pack availability is a per-language concern, resolved at start time.
  const getRecognitionLang = () => (getLocale() === 'es' ? 'es-AR' : 'en-US')

  const startRecognition = useCallback(
    (recognition: SpeechRecognitionLike, base: string) => {
      recognitionRef.current = recognition
      baseValueRef.current = base
      committedTranscriptRef.current = ''

      recognition.onresult = (event) => {
        let interim = ''
        let committed = committedTranscriptRef.current
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            committed += result[0].transcript
          } else {
            interim += result[0].transcript
          }
        }
        committedTranscriptRef.current = committed
        setValue([baseValueRef.current, committed, interim].filter(Boolean).join(' '))
      }

      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          toast.error(m.chat_dictate_permission())
        } else if (event.error === 'language-not-supported') {
          // On-device pack missing at runtime — transparently retry via cloud.
          recognition.abort()
          const fallback = createSpeechRecognition(getRecognitionLang(), 'cloud')
          if (fallback) startRecognition(fallback, baseValueRef.current)
        }
      }

      recognition.onend = () => {
        setIsListening(false)
        if (recognitionRef.current === recognition) recognitionRef.current = null
      }

      recognition.start()
      setIsListening(true)
    },
    [],
  )

  const handleMicClick = useCallback(async () => {
    if (disabled || !isSupported) return
    if (isListening) {
      recognitionRef.current?.stop()
      return
    }

    const lang = getRecognitionLang()
    const mode = modeRef.current
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
  }, [disabled, isListening, isSupported, value, startRecognition])

  // Stop recognition if the input is disabled mid-dictation, and abort on unmount.
  useEffect(() => {
    if (disabled && isListening) recognitionRef.current?.abort()
  }, [disabled, isListening])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [disabled])

  // Update the data attribute for the CSS grid auto-grow trick
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.dataset.replicatedValue = value
    }
  }, [value])

  const handleSubmit = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim())
      setValue('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const canSubmit = value.trim().length > 0 && !disabled

  return (
    <div className="relative">
      {/* No <form> wrapper - prevents Chrome autofill bar on mobile */}
      <div className="relative px-4 pb-4 pt-2 sm:px-8 sm:pb-5 bg-background">
        <div className="max-w-[860px] mx-auto">
          {emphasized && (
            <p className="mb-1.5 px-1 text-sm font-medium text-foreground">
              {m.home_composer_label()}
            </p>
          )}
          <div
            className={`
              relative flex items-end gap-3 rounded-2xl border bg-card
              transition-[border-color,box-shadow] duration-200
              ${isFocused ? 'border-primary/50 ring-2 ring-primary/10' : emphasized ? 'border-primary/30' : 'border-border/50'}
              ${disabled ? 'opacity-60' : ''}
            `}
          >
            {/* Auto-growing textarea wrapper using CSS grid trick */}
            <div
              ref={wrapperRef}
              className="
                flex-1 grid min-h-[46px]
                after:content-[attr(data-replicated-value)_'_']
                after:whitespace-pre-wrap
                after:invisible
                after:col-start-1 after:col-end-2
                after:row-start-1 after:row-end-2
                after:py-3 after:px-4
                after:text-base after:sm:text-sm
                after:leading-normal
                after:font-[inherit]
                after:border after:border-transparent
              "
              data-replicated-value={value}
            >
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={m.chat_placeholder()}
                disabled={disabled}
                rows={1}
                // Discourage autofill while preserving mobile writing assistance
                autoComplete="off"
                autoCorrect="on"
                autoCapitalize="sentences"
                spellCheck
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                aria-autocomplete="none"
                className={`
                  col-start-1 col-end-2 row-start-1 row-end-2
                  resize-none overflow-y-auto
                  max-h-40 min-h-[46px]
                  bg-transparent px-4 py-3 text-base sm:text-sm text-foreground
                  leading-normal
                  placeholder:text-muted-foreground/60
                  focus:outline-none
                  disabled:cursor-not-allowed
                `}
              />
            </div>

            <button
              type="button"
              onClick={handleMicClick}
              disabled={disabled || !isSupported}
              aria-label={isListening ? m.chat_stop_dictating() : m.chat_dictate()}
              aria-pressed={isListening}
              title={!isSupported ? m.chat_dictate_unsupported() : undefined}
              className={`
                mb-0.5 size-11 rounded-full shrink-0 transition-colors duration-200 flex items-center justify-center
                ${
                  !isSupported
                    ? 'text-muted-foreground/40 cursor-not-allowed'
                    : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                }
                ${isListening ? 'text-red-500 bg-red-500/15 hover:bg-red-500/25 animate-pulse' : ''}
              `}
            >
              <Mic className="h-4 w-4" />
              <span className="sr-only">{isListening ? m.chat_stop_dictating() : m.chat_dictate()}</span>
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`
                mr-0.5 mb-0.5 size-11 rounded-full shrink-0 flex items-center justify-center
                transition-colors duration-200
                ${
                  canSubmit
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                }
              `}
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">{m.chat_send()}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
