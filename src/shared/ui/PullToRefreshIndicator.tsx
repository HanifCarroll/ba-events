import { RefreshCw } from 'lucide-react'

interface PullToRefreshIndicatorProps {
  /** Current pull distance in pixels */
  pullDistance: number
  /** Whether currently refreshing */
  isRefreshing: boolean
  /** Threshold to trigger refresh (default: 80) */
  threshold?: number
}

/**
 * Visual indicator for pull-to-refresh gesture.
 * Shows an arrow that rotates as user pulls, then spins during refresh.
 */
export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold = 80,
}: PullToRefreshIndicatorProps) {
  if (pullDistance === 0 && !isRefreshing) return null

  // Calculate rotation based on pull progress (0 to 180 degrees)
  const progress = Math.min(pullDistance / threshold, 1)
  const rotation = progress * 180

  // Calculate opacity (fade in as user pulls)
  const opacity = Math.min(pullDistance / 30, 1)

  return (
    <div
      className="flex items-center justify-center transition-all duration-150 ease-out overflow-hidden"
      style={{
        height: pullDistance,
        opacity: isRefreshing ? 1 : opacity,
      }}
    >
      <div
        className={`
          p-2 rounded-full bg-primary/10 border border-primary/20
          ${isRefreshing ? 'animate-spin' : ''}
        `}
        style={{
          transform: isRefreshing ? undefined : `rotate(${rotation}deg)`,
        }}
      >
        <RefreshCw
          className={`h-5 w-5 ${
            progress >= 1 ? 'text-primary' : 'text-primary/60'
          }`}
        />
      </div>
    </div>
  )
}
