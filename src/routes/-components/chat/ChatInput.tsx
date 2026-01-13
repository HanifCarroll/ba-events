import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles } from 'lucide-react'
import * as m from '@/paraglide/messages'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
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
 *
 * @see https://css-tricks.com/the-cleanest-trick-for-autogrowing-textareas/
 */
export function ChatInput({
  onSend,
  disabled = false,
}: ChatInputProps) {
  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim() && !disabled) {
      onSend(value.trim())
      setValue('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const canSubmit = value.trim().length > 0 && !disabled

  return (
    <div className="relative">
      {/* Top border with gradient */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="relative px-4 py-4 sm:px-6 sm:py-5 bg-background"
      >
        <div className="max-w-3xl mx-auto">
          <div
            className={`
              relative flex items-end gap-3 rounded-2xl border bg-card
              transition-all duration-300
              ${isFocused ? 'border-primary/40 glow-gold-subtle' : 'border-border/50'}
              ${disabled ? 'opacity-60' : ''}
            `}
          >
            {/* Decorative sparkle - aligned to top when expanded */}
            <div className="absolute left-4 top-3.5 text-primary/30">
              <Sparkles className="h-4 w-4" />
            </div>

            {/* Auto-growing textarea wrapper using CSS grid trick */}
            <div
              ref={wrapperRef}
              className="
                flex-1 grid
                after:content-[attr(data-replicated-value)_'_']
                after:whitespace-pre-wrap
                after:invisible
                after:col-start-1 after:col-end-2
                after:row-start-1 after:row-end-2
                after:py-3.5 after:pl-11 after:pr-4
                after:text-base after:sm:text-sm
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
                className={`
                  col-start-1 col-end-2 row-start-1 row-end-2
                  resize-none overflow-hidden
                  max-h-40
                  bg-transparent py-3.5 pl-11 pr-4 text-base sm:text-sm text-foreground
                  placeholder:text-muted-foreground/60
                  focus:outline-none
                  disabled:cursor-not-allowed
                `}
              />
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className={`
                mr-2 mb-2 p-2.5 rounded-xl shrink-0
                transition-all duration-300
                ${
                  canSubmit
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 glow-gold'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                }
              `}
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">{m.chat_send()}</span>
            </button>
          </div>

          {/* Powered by hint */}
          <p className="text-[10px] text-muted-foreground/50 text-center mt-2 tracking-wide">
            {m.chat_powered()}
          </p>
        </div>
      </form>
    </div>
  )
}
