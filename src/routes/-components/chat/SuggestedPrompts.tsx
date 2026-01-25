import { useState } from 'react'
import { Sparkles, Moon, CalendarDays } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { track } from '@/lib/analytics'

interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void
}

type TimeContext = 'tonight' | 'weekend' | null

export function SuggestedPrompts({ onSelectPrompt }: SuggestedPromptsProps) {
  // Default to "tonight" - the 80% use case
  const [timeContext, setTimeContext] = useState<TimeContext>('tonight')

  const timeOptions = [
    { id: 'tonight' as const, label: m.context_tonight(), icon: Moon },
    { id: 'weekend' as const, label: m.context_weekend(), icon: CalendarDays },
  ]

  // Generate prompt based on time selection
  const handleSurpriseMe = () => {
    const timePart = timeContext === 'tonight'
      ? m.context_prompt_time_tonight()
      : timeContext === 'weekend'
        ? m.context_prompt_time_weekend()
        : ''

    const prompt = timePart
      ? m.context_prompt_time_only({ time: timePart })
      : m.context_prompt_surprise()

    track('concierge:surprise_me', { time: timeContext })
    onSelectPrompt(prompt)
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 sm:px-6 py-8 sm:py-12">
      {/* Hero section */}
      <div className="text-center mb-8 sm:mb-12 animate-fade-in-up">
        {/* Decorative element */}
        <div className="hidden sm:flex items-center justify-center gap-3 mb-4">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-primary/50" />
          <Sparkles className="h-5 w-5 text-primary animate-pulse-warm" />
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-primary/50" />
        </div>

        <h1 className="font-display text-2xl sm:text-4xl md:text-5xl font-semibold mb-3 sm:mb-4 tracking-tight">
          <span className="bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent">
            {m.home_title()}
          </span>
        </h1>

        <p className="text-muted-foreground text-sm sm:text-lg max-w-md mx-auto leading-relaxed">
          {m.home_subtitle()}
        </p>
      </div>

      {/* Main interaction area */}
      <div className="w-full max-w-md animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        {/* Time context chips - horizontal, centered */}
        <div className="flex justify-center gap-3 mb-6">
          {timeOptions.map((option) => {
            const Icon = option.icon
            const isSelected = timeContext === option.id
            return (
              <button
                key={option.id}
                onClick={() => setTimeContext(isSelected ? null : option.id)}
                className={`
                  group flex items-center gap-2 px-5 py-3 rounded-full text-sm font-medium transition-all duration-200
                  ${isSelected
                    ? 'bg-primary/20 border-2 border-primary/50 text-primary shadow-md shadow-primary/10'
                    : 'bg-muted/30 border border-border/40 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                  }
                `}
              >
                <Icon className={`h-4 w-4 ${isSelected ? 'text-primary' : 'text-muted-foreground group-hover:text-primary/70'}`} />
                {option.label}
              </button>
            )
          })}
        </div>

        {/* Primary CTA - always visible */}
        <div className="flex justify-center mb-8">
          <button
            onClick={handleSurpriseMe}
            className="group flex items-center gap-3 px-8 py-4 rounded-2xl text-base font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 transition-all duration-300 hover:-translate-y-0.5"
          >
            <Sparkles className="h-5 w-5" />
            {m.context_surprise_me()}
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-border/50" />
          <span className="text-xs text-muted-foreground/60 uppercase tracking-wider whitespace-nowrap">
            {m.context_or_tell_me()}
          </span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-border/50" />
        </div>

        {/* Input hint - examples of what to type */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground/70 italic">
            {m.context_input_examples()}
          </p>
        </div>
      </div>

      {/* SEO Info Section - hidden on mobile */}
      <section className="hidden md:block mt-12 max-w-xl text-center animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
        <p className="text-xs text-muted-foreground/50 leading-relaxed">
          {m.home_about_text()}
        </p>
      </section>
    </div>
  )
}
