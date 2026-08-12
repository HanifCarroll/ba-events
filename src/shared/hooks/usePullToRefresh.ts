import { useRef, useCallback, useEffect } from 'react'

interface UsePullToRefreshOptions {
  /** Callback when refresh is triggered */
  onRefresh?: () => void | Promise<void>
  /** Threshold in pixels to trigger refresh (default: 80) */
  threshold?: number
  /** Maximum pull distance in pixels (default: 128) */
  maxPull?: number
  /** Whether pull-to-refresh is enabled (default: true) */
  enabled?: boolean
}

interface UsePullToRefreshReturn {
  /** Ref to attach to the scrollable container */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Ref to attach to the pull indicator element */
  indicatorRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Attempt function for smooth pull resistance (exponential decay).
 * Prevents pulling too far while maintaining smooth feel.
 */
function applyResistance(distance: number, maxPull: number): number {
  const k = 0.4
  return maxPull * (1 - Math.exp((-k * distance) / maxPull))
}

/**
 * Custom pull-to-refresh hook for internal scroll containers.
 *
 * Uses direct DOM manipulation during touch for 60fps performance,
 * avoiding React state updates that cause lag.
 *
 * @example
 * ```tsx
 * const { containerRef, indicatorRef } = usePullToRefresh({
 *   onRefresh: () => window.location.reload(),
 * })
 *
 * return (
 *   <div ref={containerRef} className="overflow-y-auto">
 *     <div ref={indicatorRef} className="pull-indicator" />
 *     {content}
 *   </div>
 * )
 * ```
 */
export function usePullToRefresh({
  onRefresh = () => window.location.reload(),
  threshold = 80,
  maxPull = 128,
  enabled = true,
}: UsePullToRefreshOptions = {}): UsePullToRefreshReturn {
  const containerRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)

  // Touch tracking refs (no state updates during touch!)
  const touchStartY = useRef(0)
  const currentPull = useRef(0)
  const isAtTop = useRef(false)
  const isPulling = useRef(false)
  const isRefreshing = useRef(false)

  // Update indicator DOM directly (no React re-renders)
  const updateIndicator = useCallback((distance: number, refreshing: boolean) => {
    const indicator = indicatorRef.current
    if (!indicator) return

    if (distance === 0 && !refreshing) {
      indicator.style.height = '0px'
      indicator.style.opacity = '0'
      return
    }

    // Calculate visual values
    const progress = Math.min(distance / threshold, 1)
    const rotation = progress * 180
    const opacity = Math.min(distance / 30, 1)

    // Apply styles directly to DOM
    indicator.style.height = `${distance}px`
    indicator.style.opacity = refreshing ? '1' : String(opacity)

    // Update inner icon rotation
    const icon = indicator.querySelector('[data-pull-icon]') as HTMLElement
    if (icon) {
      if (refreshing) {
        icon.style.transform = ''
        icon.classList.add('animate-spin')
      } else {
        icon.classList.remove('animate-spin')
        icon.style.transform = `rotate(${rotation}deg)`
      }

      // Change color when threshold reached
      const iconSvg = icon.querySelector('svg')
      if (iconSvg) {
        iconSvg.style.color = progress >= 1 ? 'var(--primary)' : 'var(--primary-60)'
      }
    }
  }, [threshold])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || isRefreshing.current) return

    // Horizontal carousels own their gestures. Letting pull-to-refresh track
    // the same touch can cancel a slightly diagonal swipe on mobile.
    if (e.target instanceof Element && e.target.closest('[data-horizontal-scroll]')) {
      isAtTop.current = false
      return
    }

    const container = containerRef.current
    if (!container) return

    // Only enable pull-to-refresh when scrolled to top
    isAtTop.current = container.scrollTop <= 0
    if (!isAtTop.current) return

    touchStartY.current = e.touches[0].clientY
    currentPull.current = 0
    isPulling.current = false

    // Remove transition during touch for responsive feel
    const indicator = indicatorRef.current
    if (indicator) {
      indicator.style.transition = 'none'
    }
  }, [enabled])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || isRefreshing.current || !isAtTop.current) return

    const container = containerRef.current
    if (!container) return

    // Re-check if at top (user might have scrolled)
    if (container.scrollTop > 0) {
      isAtTop.current = false
      isPulling.current = false
      updateIndicator(0, false)
      return
    }

    const touchY = e.touches[0].clientY
    const deltaY = touchY - touchStartY.current

    // Only trigger on pull down (positive delta)
    if (deltaY <= 0) {
      isPulling.current = false
      updateIndicator(0, false)
      currentPull.current = 0
      return
    }

    // Apply resistance for natural feel
    const adjustedPull = applyResistance(deltaY, maxPull)
    currentPull.current = adjustedPull
    isPulling.current = true

    // Update DOM directly (no React state!)
    updateIndicator(adjustedPull, false)

    // Prevent default scrolling while pulling
    if (adjustedPull > 10) {
      e.preventDefault()
    }
  }, [enabled, maxPull, updateIndicator])

  const handleTouchEnd = useCallback(async () => {
    if (!enabled || isRefreshing.current) return

    const pulled = currentPull.current
    const indicator = indicatorRef.current

    // Add transition for smooth snap-back
    if (indicator) {
      indicator.style.transition = 'height 0.2s ease-out, opacity 0.2s ease-out'
    }

    if (pulled >= threshold) {
      // Trigger refresh
      isRefreshing.current = true
      updateIndicator(threshold, true) // Hold at threshold during refresh

      try {
        await onRefresh()
      } finally {
        isRefreshing.current = false
        updateIndicator(0, false)
      }
    } else {
      // Snap back
      updateIndicator(0, false)
    }

    isPulling.current = false
    currentPull.current = 0
    isAtTop.current = false
  }, [enabled, threshold, onRefresh, updateIndicator])

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
    indicatorRef,
  }
}
