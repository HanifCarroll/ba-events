import { Search, ArrowRight, MessageSquare } from 'lucide-react'
import type { SearchTerm } from '@/features/analytics/types'

interface SearchTermsTableProps {
  data: SearchTerm[]
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

          {/* Query skeleton */}
          <div className="flex items-center gap-2 flex-1">
            <div className="h-4 w-4 bg-muted/40 rounded animate-pulse" />
            <div
              className="h-4 bg-muted/40 rounded animate-pulse"
              style={{ width: `${40 + Math.random() * 40}%` }}
            />
          </div>

          {/* Stats skeleton */}
          <div className="h-4 w-20 bg-muted/40 rounded animate-pulse" />
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
          font-bold text-sm border flex-shrink-0
          ${medalStyles.bg} ${medalStyles.border} ${medalStyles.text} ${medalStyles.glow}
        `}
      >
        {rank}
      </div>
    )
  }

  return (
    <div className="w-8 h-8 rounded-full bg-muted/30 flex items-center justify-center text-muted-foreground text-sm font-medium flex-shrink-0">
      {rank}
    </div>
  )
}

export function SearchTermsTable({ data, loading }: SearchTermsTableProps) {
  if (loading) {
    return <TableSkeleton />
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="p-4 rounded-full bg-muted/30 mb-4">
          <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <p className="text-muted-foreground font-medium">No search data yet</p>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-[200px]">
          Search terms will appear as users ask questions
        </p>
      </div>
    )
  }

  // Calculate max count for bar width
  const maxCount = Math.max(...data.map((term) => term.count))

  return (
    <div className="space-y-2">
      {data.map((term, index) => {
        const rank = index + 1
        const barWidth = maxCount > 0 ? (term.count / maxCount) * 100 : 0

        return (
          <div
            key={term.query}
            className="group relative p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-all duration-200 overflow-hidden"
          >
            {/* Background bar */}
            <div
              className="absolute inset-y-0 left-0 bg-primary/5 transition-all duration-300"
              style={{ width: `${barWidth}%` }}
            />

            <div className="relative flex items-center gap-4">
              {/* Rank with medal */}
              <RankIndicator rank={rank} />

              {/* Search icon and query */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                <span className="font-medium text-foreground truncate">
                  "{term.query}"
                </span>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-shrink-0">
                <span className="font-semibold text-foreground tabular-nums">
                  {term.count.toLocaleString()}
                </span>
                <span className="text-muted-foreground/70">
                  {term.count === 1 ? 'search' : 'searches'}
                </span>
                {term.avgResultsReturned > 0 && (
                  <div
                    className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground/70"
                    title="Average results returned"
                  >
                    <ArrowRight className="h-3 w-3" />
                    <span>{term.avgResultsReturned} avg results</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
