import { Link } from '@tanstack/react-router'
import { Eye, Bookmark, ExternalLink, Calendar } from 'lucide-react'
import type { TopEvent } from '@/features/analytics/types'

interface TopEventsTableProps {
  data: TopEvent[]
  loading: boolean
}

// Skeleton loader for table rows
function TableSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-3 rounded-lg bg-muted/20"
        >
          {/* Rank skeleton */}
          <div className="w-8 h-8 rounded-full bg-muted/40 animate-pulse" />

          {/* Name skeleton */}
          <div className="flex-1">
            <div
              className="h-4 bg-muted/40 rounded animate-pulse"
              style={{ width: `${60 + Math.random() * 30}%` }}
            />
          </div>

          {/* Stats skeleton */}
          <div className="flex items-center gap-4">
            <div className="h-4 w-10 bg-muted/40 rounded animate-pulse" />
            <div className="h-4 w-10 bg-muted/40 rounded animate-pulse" />
            <div className="h-4 w-10 bg-muted/40 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Rank indicator with medals for top 3
function RankIndicator({ rank }: { rank: number }) {
  if (rank <= 3) {
    const medalStyles = {
      1: {
        bg: 'bg-amber-500/20',
        border: 'border-amber-500/40',
        text: 'text-amber-400',
        glow: 'shadow-[0_0_8px_rgba(245,158,11,0.3)]',
      },
      2: {
        bg: 'bg-slate-400/20',
        border: 'border-slate-400/40',
        text: 'text-slate-300',
        glow: 'shadow-[0_0_8px_rgba(148,163,184,0.2)]',
      },
      3: {
        bg: 'bg-orange-600/20',
        border: 'border-orange-600/40',
        text: 'text-orange-400',
        glow: 'shadow-[0_0_8px_rgba(234,88,12,0.2)]',
      },
    }[rank]!

    return (
      <div
        className={`
          w-8 h-8 rounded-full flex items-center justify-center
          font-bold text-sm border
          ${medalStyles.bg} ${medalStyles.border} ${medalStyles.text} ${medalStyles.glow}
        `}
      >
        {rank}
      </div>
    )
  }

  return (
    <div className="w-8 h-8 rounded-full bg-muted/30 flex items-center justify-center text-muted-foreground text-sm font-medium">
      {rank}
    </div>
  )
}

export function TopEventsTable({ data, loading }: TopEventsTableProps) {
  if (loading) {
    return <TableSkeleton />
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="p-4 rounded-full bg-muted/30 mb-4">
          <Calendar className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <p className="text-muted-foreground font-medium">No event engagement data yet</p>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-[200px]">
          Engagement metrics will appear as users interact with events
        </p>
      </div>
    )
  }

  // Calculate max views for relative bar
  const maxViews = Math.max(...data.map((e) => e.views))

  return (
    <div className="space-y-2">
      {data.map((event, index) => {
        const rank = index + 1
        const barWidth = maxViews > 0 ? (event.views / maxViews) * 100 : 0

        return (
          <div
            key={event.eventId}
            className="group relative flex items-center gap-4 p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-all duration-200 overflow-hidden"
          >
            {/* Background progress bar */}
            <div
              className="absolute inset-y-0 left-0 bg-primary/5 transition-all duration-300"
              style={{ width: `${barWidth}%` }}
            />

            {/* Content */}
            <div className="relative flex items-center gap-4 w-full">
              {/* Rank with medal */}
              <RankIndicator rank={rank} />

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
                <div
                  className="flex items-center gap-1.5 group-hover:text-foreground transition-colors"
                  title="Views"
                >
                  <Eye className="h-4 w-4" />
                  <span className="font-medium tabular-nums">{event.views.toLocaleString()}</span>
                </div>
                <div
                  className="flex items-center gap-1.5 group-hover:text-green-400 transition-colors"
                  title="Saves"
                >
                  <Bookmark className="h-4 w-4" />
                  <span className="font-medium tabular-nums">{event.saves.toLocaleString()}</span>
                </div>
                <div
                  className="flex items-center gap-1.5 group-hover:text-primary transition-colors"
                  title="Link clicks"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="font-medium tabular-nums">{event.clicks.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
