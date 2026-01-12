import { Calendar, Music, Ticket, Sparkles } from 'lucide-react'
import * as m from '@/paraglide/messages'

interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void
}

export function SuggestedPrompts({ onSelectPrompt }: SuggestedPromptsProps) {
  // Use translated prompts
  // First 2 shown on mobile, all 4 on desktop
  const prompts = [
    { text: m.prompt_tonight(), icon: Calendar },
    { text: m.prompt_free(), icon: Ticket },
    { text: m.prompt_live_music(), icon: Music },
    { text: m.prompt_surprise_me(), icon: Sparkles },
  ]

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
