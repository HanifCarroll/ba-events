import { Moon, Calendar, Ticket, MapPin, Sparkles } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { RefinementSuggestion } from '@/shared/lib/types'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  moon: Moon,
  calendar: Calendar,
  ticket: Ticket,
  'map-pin': MapPin,
  sparkles: Sparkles,
}

interface RefinementSuggestionsProps {
  suggestions: RefinementSuggestion[]
  onSelect: (prompt: string) => void
  disabled?: boolean
}

export function RefinementSuggestions({
  suggestions,
  onSelect,
  disabled,
}: RefinementSuggestionsProps) {
  if (suggestions.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mt-4 animate-fade-in-up">
      {suggestions.map((suggestion) => {
        const Icon = suggestion.icon ? iconMap[suggestion.icon] : null
        return (
          <button
            key={suggestion.id}
            onClick={() => onSelect(suggestion.prompt)}
            disabled={disabled}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5',
              'text-xs font-medium rounded-full',
              'border border-border/50 bg-card/50',
              'hover:border-primary/30 hover:bg-card hover:text-primary',
              'transition-all duration-200',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {suggestion.label}
          </button>
        )
      })}
    </div>
  )
}
