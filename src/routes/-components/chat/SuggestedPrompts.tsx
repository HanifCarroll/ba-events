import { useState } from 'react'
import { Calendar, Music, Ticket, Sparkles, Moon, CalendarDays, User, Heart, Users } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { track } from '@/lib/analytics'

interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void
}

type TimeContext = 'tonight' | 'weekend' | null
type GroupContext = 'solo' | 'date' | 'friends' | null

export function SuggestedPrompts({ onSelectPrompt }: SuggestedPromptsProps) {
  const [timeContext, setTimeContext] = useState<TimeContext>(null)
  const [groupContext, setGroupContext] = useState<GroupContext>(null)

  // Context options for quick selection
  const timeOptions = [
    { id: 'tonight' as const, label: m.context_tonight(), icon: Moon },
    { id: 'weekend' as const, label: m.context_weekend(), icon: CalendarDays },
  ]

  const groupOptions = [
    { id: 'solo' as const, label: m.context_solo(), icon: User },
    { id: 'date' as const, label: m.context_date(), icon: Heart },
    { id: 'friends' as const, label: m.context_friends(), icon: Users },
  ]

  // Generate contextual prompt based on selections (localized)
  const handleContextSubmit = () => {
    const timePart = timeContext === 'tonight'
      ? m.context_prompt_time_tonight()
      : timeContext === 'weekend'
        ? m.context_prompt_time_weekend()
        : ''

    const groupPart = groupContext === 'solo'
      ? m.context_prompt_group_solo()
      : groupContext === 'date'
        ? m.context_prompt_group_date()
        : groupContext === 'friends'
          ? m.context_prompt_group_friends()
          : ''

    let prompt = m.context_prompt_surprise()
    if (timePart && groupPart) {
      prompt = m.context_prompt_time_and_group({ time: timePart, group: groupPart })
    } else if (timePart) {
      prompt = m.context_prompt_time_only({ time: timePart })
    } else if (groupPart) {
      prompt = m.context_prompt_group_only({ group: groupPart })
    }

    track('concierge:context_prompt', { time: timeContext, group: groupContext })
    onSelectPrompt(prompt)
  }

  // Use translated prompts
  // First 2 shown on mobile, all 4 on desktop
  const prompts = [
    { text: m.prompt_tonight(), icon: Calendar },
    { text: m.prompt_free(), icon: Ticket },
    { text: m.prompt_live_music(), icon: Music },
    { text: m.prompt_surprise_me(), icon: Sparkles },
  ]

  const hasContext = timeContext || groupContext

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 sm:px-6 py-4 sm:py-8 short:py-2 short:sm:py-4">
      {/* Hero section */}
      <div className="text-center mb-6 sm:mb-10 short:mb-3 short:sm:mb-4 animate-fade-in-up">
        {/* Decorative element - hidden on small screens and short viewports */}
        <div className="hidden sm:flex short:sm:hidden items-center justify-center gap-3 mb-4">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-primary/50" />
          <Sparkles className="h-5 w-5 text-primary animate-pulse-warm" />
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-primary/50" />
        </div>

        <h1 className="font-display text-2xl sm:text-4xl md:text-5xl short:text-xl short:sm:text-2xl short:md:text-3xl font-semibold mb-2 sm:mb-4 short:mb-1 short:sm:mb-2 tracking-tight">
          <span className="bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent">
            {m.home_title()}
          </span>
        </h1>

        <p className="text-muted-foreground text-sm sm:text-lg short:text-xs short:sm:text-sm max-w-md mx-auto leading-relaxed">
          {m.home_subtitle()}
        </p>

        {/* Decorative line - hidden on mobile and short viewports */}
        <div className="deco-line w-32 mx-auto mt-4 sm:mt-6 hidden sm:block short:sm:hidden" />
      </div>

      {/* Context gathering chips */}
      <div className="w-full max-w-xl mb-6 sm:mb-8 short:mb-4 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        <p className="text-xs text-muted-foreground/70 uppercase tracking-wider font-medium mb-3 text-center">
          {m.context_quick_start()}
        </p>

        {/* Time context row */}
        <div className="flex justify-center gap-2 mb-3">
          {timeOptions.map((option) => {
            const Icon = option.icon
            const isSelected = timeContext === option.id
            return (
              <button
                key={option.id}
                onClick={() => setTimeContext(isSelected ? null : option.id)}
                className={`
                  group flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200
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

        {/* Group context row */}
        <div className="flex justify-center gap-2">
          {groupOptions.map((option) => {
            const Icon = option.icon
            const isSelected = groupContext === option.id
            return (
              <button
                key={option.id}
                onClick={() => setGroupContext(isSelected ? null : option.id)}
                className={`
                  group flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200
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

        {/* Go button - appears when context is selected */}
        {hasContext && (
          <div className="flex justify-center mt-4 animate-fade-in-up">
            <button
              onClick={handleContextSubmit}
              className="group flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 transition-all duration-300 hover:-translate-y-0.5"
            >
              <Sparkles className="h-4 w-4" />
              {m.context_find_me_something()}
            </button>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-full max-w-xl flex items-center gap-4 mb-6 short:mb-4">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent to-border/50" />
        <span className="text-xs text-muted-foreground/50 uppercase tracking-wider">{m.context_or_try()}</span>
        <div className="flex-1 h-px bg-gradient-to-l from-transparent to-border/50" />
      </div>

      {/* Prompt cards - show only 2 on mobile, all 4 on larger screens */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 short:gap-2 short:sm:gap-3 w-full max-w-xl stagger-children">
        {prompts.map((prompt, index) => {
          const Icon = prompt.icon
          // Hide 3rd and 4th prompts on mobile
          const mobileHidden = index >= 2 ? 'hidden sm:flex' : ''
          return (
            <button
              key={prompt.text}
              onClick={() => onSelectPrompt(prompt.text)}
              className={`group relative overflow-hidden rounded-xl border border-border/50 bg-card p-3 sm:p-5 short:p-2 short:sm:p-3 text-left transition-all duration-300 hover:border-primary/30 hover:bg-card/90 hover:glow-gold-subtle ${mobileHidden}`}
            >
              {/* Hover gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              <div className="relative flex items-center sm:items-start gap-3 sm:gap-4">
                <div className="shrink-0 p-2 sm:p-2.5 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors duration-300">
                  <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs sm:text-sm font-medium text-foreground group-hover:text-primary transition-colors duration-300">
                    {prompt.text}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* SEO Info Section - provides indexable content for search engines (hidden on mobile and short viewports) */}
      <section className="hidden md:block short:md:hidden mt-8 short:mt-4 max-w-xl text-center">
        <p className="text-xs text-muted-foreground/50 leading-relaxed">
          {m.home_about_text()}
        </p>
      </section>

      {/* Footer hint - hidden on mobile and short viewports to save space */}
      <div className="hidden sm:block short:sm:hidden mt-6 text-center animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {m.home_hint()}
          <span className="block mt-1 text-primary/70">
            {m.home_examples()}
          </span>
        </p>
      </div>
    </div>
  )
}
