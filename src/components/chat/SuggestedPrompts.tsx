import { Calendar, Music, Ticket, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <div className="flex flex-col items-center justify-center h-full px-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">BA Events</h1>
        <p className="text-muted-foreground">
          Discover what's happening in Buenos Aires
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {SUGGESTED_PROMPTS.map((prompt) => {
          const Icon = iconMap[prompt.icon]
          return (
            <Button
              key={prompt.text}
              variant="outline"
              className="h-auto py-4 px-4 justify-start text-left"
              onClick={() => onSelectPrompt(prompt.text)}
            >
              <Icon className="h-5 w-5 mr-3 shrink-0 text-muted-foreground" />
              <span className="text-sm">{prompt.text}</span>
            </Button>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-8 text-center max-w-md">
        Ask me about events, venues, neighborhoods, or specific vibes.
        I can help you find techno nights, jazz bars, free markets, and more!
      </p>
    </div>
  )
}
