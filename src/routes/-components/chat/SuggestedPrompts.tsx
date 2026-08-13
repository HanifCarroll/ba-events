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
  timeContext: HomeTimeContext
  onTimeContextChange: (context: HomeTimeContext) => void
}

export type HomeTimeContext = 'tonight' | 'weekend' | null

export function SuggestedPrompts({
  onSelectPrompt,
  trendingEvents,
  timeContext,
  onTimeContextChange,
}: SuggestedPromptsProps) {
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
    <div className="flex min-h-full flex-col items-center px-4 py-5 sm:px-8 sm:py-10">
      <div className="flex w-full max-w-[620px] flex-1 flex-col animate-fade-in-up">
        <div className="mb-4 flex flex-col items-center text-center sm:mb-6">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
            {m.home_title()}
          </h1>
        </div>

        <TrendingEvents onSelectPrompt={onSelectPrompt} initialEvents={trendingEvents} />

        <div className="mt-auto pt-4">
          <div className="rounded-xl bg-muted/45 px-3 py-3 sm:px-4">
            <div className="mb-2.5">
              <p className="text-sm font-medium text-foreground">{m.home_surprise_label()}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{m.home_surprise_hint()}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {timeOptions.map((option) => {
                const Icon = option.icon
                const isSelected = timeContext === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onTimeContextChange(isSelected ? null : option.id)}
                    aria-pressed={isSelected}
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
                type="button"
                onClick={handleSurpriseMe}
                className="flex min-h-11 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {m.context_surprise_submit()}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
