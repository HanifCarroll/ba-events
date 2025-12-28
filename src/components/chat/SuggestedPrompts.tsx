import { Calendar, Music, Ticket, MapPin, Sparkles } from 'lucide-react'
import { SUGGESTED_PROMPTS } from '@/lib/types'

const iconMap = {
  calendar: Calendar,
  music: Music,
  ticket: Ticket,
  'map-pin': MapPin,
}

interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void
}

export function SuggestedPrompts({ onSelectPrompt }: SuggestedPromptsProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12">
      {/* Hero section */}
      <div className="text-center mb-12 animate-fade-in-up">
        {/* Decorative element */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-primary/50" />
          <Sparkles className="h-5 w-5 text-primary animate-pulse-warm" />
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-primary/50" />
        </div>

        <h1 className="font-display text-4xl md:text-5xl font-semibold mb-4 tracking-tight">
          <span className="bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent">
            Discover Buenos Aires
          </span>
        </h1>

        <p className="text-muted-foreground text-lg max-w-md mx-auto leading-relaxed">
          Your AI guide to the city's hidden gems, late-night venues, and unforgettable experiences.
        </p>

        {/* Decorative line */}
        <div className="deco-line w-32 mx-auto mt-8" />
      </div>

      {/* Prompt cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl stagger-children">
        {SUGGESTED_PROMPTS.map((prompt) => {
          const Icon = iconMap[prompt.icon]
          return (
            <button
              key={prompt.text}
              onClick={() => onSelectPrompt(prompt.text)}
              className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-5 text-left transition-all duration-300 hover:border-primary/30 hover:bg-card/90 hover:glow-gold-subtle"
            >
              {/* Hover gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              <div className="relative flex items-start gap-4">
                <div className="shrink-0 p-2.5 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors duration-300">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors duration-300">
                    {prompt.text}
                  </span>
                </div>
              </div>

              {/* Corner accent */}
              <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </button>
          )
        })}
      </div>

      {/* Footer hint */}
      <div className="mt-12 text-center animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Ask about events, venues, neighborhoods, or specific vibes.
          <span className="block mt-1 text-primary/70">
            Techno nights • Jazz bars • Free markets • Tango milongas
          </span>
        </p>
      </div>
    </div>
  )
}
