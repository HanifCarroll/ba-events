import { useState } from 'react'
import { Sparkles, Moon, CalendarDays } from 'lucide-react'
import * as m from '@/paraglide/messages'
import type { ChatEventPayload } from '@/shared/lib/types'
import { track } from '@/lib/analytics'
import { TrendingEvents } from './TrendingEvents'

interface SuggestedPromptsProps {
  /** @param options.eventId exact event tapped (from trending cards) — hidden from chat text */
  onSelectPrompt: (prompt: string, options?: { eventId?: string }) => void
  /** Prefetched trending events from the route loader. */
  trendingEvents?: ChatEventPayload[]
}

type TimeContext = 'tonight' | 'weekend' | null

export function SuggestedPrompts({ onSelectPrompt, trendingEvents }: SuggestedPromptsProps) {
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
    <div className="flex min-h-full flex-col items-center px-4 py-10 sm:px-8 sm:py-14">
      <div className="m-auto w-full max-w-[620px] animate-fade-in-up">
        <div className="mb-8 flex flex-col items-center text-center sm:mb-9">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
            {m.home_title()}
          </h1>
        </div>

        <div className="flex flex-col items-center">
          <div className="flex flex-wrap justify-center gap-2">
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
          <p className="mt-3 text-sm text-muted-foreground">
            {m.context_input_examples()}
          </p>
        </div>

        <TrendingEvents onSelectPrompt={onSelectPrompt} initialEvents={trendingEvents} />
      </div>
    </div>
  )
}
