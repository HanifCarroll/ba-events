import { Link } from '@tanstack/react-router'
import { Eye, Bookmark, ExternalLink } from 'lucide-react'
import type { TopEvent } from '@/features/analytics/types'

interface TopEventsTableProps {
  data: TopEvent[]
  loading: boolean
}

export function TopEventsTable({ data, loading }: TopEventsTableProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No event engagement data yet
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {data.map((event, index) => (
        <div
          key={event.eventId}
          className="flex items-center gap-4 p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors"
        >
          {/* Rank */}
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-semibold flex items-center justify-center">
            {index + 1}
          </div>

          {/* Event name */}
          <div className="flex-1 min-w-0">
            <Link
              to="/event/$id"
              params={{ id: event.eventId }}
              className="font-medium text-foreground hover:text-primary truncate block transition-colors"
            >
              {event.eventName}
            </Link>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1" title="Views">
              <Eye className="h-3.5 w-3.5" />
              <span>{event.views.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1" title="Saves">
              <Bookmark className="h-3.5 w-3.5" />
              <span>{event.saves.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1" title="Link clicks">
              <ExternalLink className="h-3.5 w-3.5" />
              <span>{event.clicks.toLocaleString()}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
