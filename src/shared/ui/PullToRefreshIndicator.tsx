import { forwardRef } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Visual indicator for pull-to-refresh gesture.
 * Controlled via direct DOM manipulation by usePullToRefresh hook for 60fps performance.
 *
 * The hook manipulates:
 * - height and opacity on the container
 * - transform rotation on [data-pull-icon]
 * - animate-spin class during refresh
 */
export const PullToRefreshIndicator = forwardRef<HTMLDivElement>(
  function PullToRefreshIndicator(_, ref) {
    return (
      <div
        ref={ref}
        className="flex items-center justify-center overflow-hidden"
        style={{ height: 0, opacity: 0 }}
      >
        <div
          data-pull-icon
          className="p-2 rounded-full bg-primary/10 border border-primary/20"
        >
          <RefreshCw className="h-5 w-5 text-primary/60" />
        </div>
      </div>
    )
  }
)
