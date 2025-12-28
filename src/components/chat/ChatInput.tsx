import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles } from 'lucide-react'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Ask about events in Buenos Aires...',
}: ChatInputProps) {
  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus()
    }
  }, [disabled])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim() && !disabled) {
      onSend(value.trim())
      setValue('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        className="relative px-4 py-4 sm:px-6 sm:py-5 bg-background"
      >
        <div className="max-w-3xl mx-auto">
          <div
            className={`
              relative flex items-center gap-3 rounded-2xl border bg-card
              transition-all duration-300
              ${isFocused ? 'border-primary/40 glow-gold-subtle' : 'border-border/50'}
              ${disabled ? 'opacity-60' : ''}
            `}
          >
            {/* Decorative sparkle */}
            <div className="absolute left-4 text-primary/30">
              <Sparkles className="h-4 w-4" />
            </div>

            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={placeholder}
              disabled={disabled}
              autoComplete="off"
              className={`
                flex-1 bg-transparent py-3.5 pl-11 pr-4 text-sm text-foreground
                placeholder:text-muted-foreground/60
                focus:outline-none
                disabled:cursor-not-allowed
              `}
            />

            <button
              type="submit"
              disabled={!canSubmit}
              className={`
                mr-2 p-2.5 rounded-xl
                transition-all duration-300
                ${
                  canSubmit
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 glow-gold'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                }
              `}
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">Send message</span>
            </button>
          </div>

          {/* Powered by hint */}
          <p className="text-[10px] text-muted-foreground/50 text-center mt-2 tracking-wide">
            Powered by AI • Discover what's happening tonight
          </p>
        </div>
      </form>
    </div>
  )
}
