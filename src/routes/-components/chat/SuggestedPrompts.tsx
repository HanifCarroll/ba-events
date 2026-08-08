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
    <div className="flex h-full flex-col items-center justify-center px-4 py-10 sm:px-8 sm:py-14">
      <div className="w-full max-w-[620px] animate-fade-in-up">
        <div className="mb-8 flex items-start gap-3 sm:mb-10">
          <Sparkles className="mt-1 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
              {m.home_title()}
            </h1>
            <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
              {m.home_subtitle()}
            </p>
          </div>
        </div>

        <div className="border-y border-border py-5">
          <p className="mb-3 text-sm font-medium text-foreground">{m.context_or_tell_me()}</p>
          <div className="flex flex-wrap gap-2">
            {timeOptions.map((option) => {
              const Icon = option.icon
              const isSelected = timeContext === option.id
              return (
                <button
                  key={option.id}
                  onClick={() => setTimeContext(isSelected ? null : option.id)}
                  className={`flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isSelected
                      ? 'border-primary/30 bg-primary/[0.07] text-primary'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {option.label}
                </button>
              )
            })}
            <button
              onClick={handleSurpriseMe}
              className="flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {m.context_surprise_me()}
            </button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {m.context_input_examples()}
          </p>
        </div>

        <section className="mt-7 hidden max-w-[62ch] md:block">
          <p className="text-xs leading-relaxed text-muted-foreground/80">
            {m.home_about_text()}
          </p>
        </section>
      </div>
    </div>
  )
}
