import { useState, useRef, useCallback, useEffect } from 'react'

interface UsePullToRefreshOptions {
  /** Callback when refresh is triggered */
  onRefresh?: () => void | Promise<void>
  /** Threshold in pixels to trigger refresh (default: 80) */
  threshold?: number
  /** Maximum pull distance in pixels (default: 120) */
  maxPull?: number
  /** Whether pull-to-refresh is enabled (default: true) */
  enabled?: boolean
}

interface UsePullToRefreshReturn {
  /** Ref to attach to the scrollable container */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Current pull distance (0 when not pulling) */
  pullDistance: number
  /** Whether currently refreshing */
  isRefreshing: boolean
  /** Whether actively pulling */
  isPulling: boolean
}

/**
 * Custom pull-to-refresh hook for internal scroll containers.
 *
 * Works with elements that have overflow-y: auto/scroll, unlike native
 * pull-to-refresh which only works on the document body.
 *
 * @example
 * ```tsx
 * const { containerRef, pullDistance, isRefreshing, isPulling } = usePullToRefresh({
 *   onRefresh: () => window.location.reload(),
 * })
 *
 * return (
 *   <div ref={containerRef} className="overflow-y-auto">
 *     {isPulling && <PullIndicator distance={pullDistance} />}
 *     {content}
 *   </div>
 * )
 * ```
 */
export function usePullToRefresh({
  onRefresh = () => window.location.reload(),
  threshold = 80,
  maxPull = 120,
  enabled = true,
}: UsePullToRefreshOptions = {}): UsePullToRefreshReturn {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)

  // Touch tracking refs (avoid state updates during touch move)
  const touchStartY = useRef(0)
  const currentPullDistance = useRef(0)
  const isAtTop = useRef(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || isRefreshing) return

    const container = containerRef.current
    if (!container) return

    // Only enable pull-to-refresh when scrolled to top
    isAtTop.current = container.scrollTop <= 0
    if (!isAtTop.current) return

    touchStartY.current = e.touches[0].clientY
    currentPullDistance.current = 0
  }, [enabled, isRefreshing])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || isRefreshing || !isAtTop.current) return

    const container = containerRef.current
    if (!container) return

    // Re-check if at top (user might have scrolled)
    if (container.scrollTop > 0) {
      isAtTop.current = false
      setIsPulling(false)
      setPullDistance(0)
      return
    }

    const touchY = e.touches[0].clientY
    const deltaY = touchY - touchStartY.current

    // Only trigger on pull down (positive delta)
    if (deltaY <= 0) {
      setIsPulling(false)
      setPullDistance(0)
      currentPullDistance.current = 0
      return
    }

    // Apply resistance (deceleration) as user pulls further
    const resistance = Math.min(deltaY / maxPull, 1)
    const adjustedPull = deltaY * (1 - resistance * 0.5)
    const clampedPull = Math.min(adjustedPull, maxPull)

    currentPullDistance.current = clampedPull
    setPullDistance(clampedPull)
    setIsPulling(true)

    // Prevent default scrolling while pulling
    if (clampedPull > 10) {
      e.preventDefault()
    }
  }, [enabled, isRefreshing, maxPull])

  const handleTouchEnd = useCallback(async () => {
    if (!enabled || isRefreshing) return

    const pulled = currentPullDistance.current

    if (pulled >= threshold) {
      // Trigger refresh
      setIsRefreshing(true)
      setPullDistance(threshold) // Keep at threshold during refresh

      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      // Snap back
      setPullDistance(0)
    }

    setIsPulling(false)
    currentPullDistance.current = 0
    isAtTop.current = false
  }, [enabled, isRefreshing, threshold, onRefresh])

  // Attach touch event listeners
  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) return

    // Use passive: false for touchmove to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd])

  return {
    containerRef,
    pullDistance,
    isRefreshing,
    isPulling,
  }
}
