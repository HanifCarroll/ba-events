import { Search, ArrowRight } from 'lucide-react'
import type { SearchTerm } from '@/features/analytics/types'

interface SearchTermsTableProps {
  data: SearchTerm[]
  loading: boolean
}

export function SearchTermsTable({ data, loading }: SearchTermsTableProps) {
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
        No search data yet
      </div>
    )
  }

  // Calculate max count for bar width
  const maxCount = Math.max(...data.map((term) => term.count))

  return (
    <div className="space-y-2">
      {data.map((term, index) => {
        const barWidth = (term.count / maxCount) * 100

        return (
          <div
            key={term.query}
            className="relative p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors overflow-hidden"
          >
            {/* Background bar */}
            <div
              className="absolute inset-y-0 left-0 bg-primary/10"
              style={{ width: `${barWidth}%` }}
            />

            <div className="relative flex items-center gap-4">
              {/* Rank */}
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-semibold flex items-center justify-center">
                {index + 1}
              </div>

              {/* Search icon and query */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="font-medium text-foreground truncate">
                  "{term.query}"
                </span>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-shrink-0">
                <span className="font-medium">
                  {term.count.toLocaleString()} {term.count === 1 ? 'search' : 'searches'}
                </span>
                {term.avgResultsReturned > 0 && (
                  <div className="flex items-center gap-1 text-xs" title="Avg results returned">
                    <ArrowRight className="h-3 w-3" />
                    <span>{term.avgResultsReturned} results</span>
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
