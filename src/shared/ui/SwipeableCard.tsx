import { useRef, useCallback, useState, type ReactNode } from 'react'

interface SwipeAction {
  icon: ReactNode
  label: string
  onClick: () => void
  variant: 'primary' | 'destructive' | 'warning'
}

interface SwipeableCardProps {
  children: ReactNode
  leftActions?: SwipeAction[]
  rightActions?: SwipeAction[]
  onLongPress?: () => void
  className?: string
}

const ACTION_WIDTH = 72 // Width of each action button
const SWIPE_THRESHOLD = 40 // Minimum swipe distance to reveal actions
const VELOCITY_THRESHOLD = 0.3 // Velocity threshold for quick swipes

/**
 * SwipeableCard - iOS-style swipe-to-reveal actions
 *
 * Uses direct DOM manipulation for 60fps performance.
 * Swipe left to reveal right actions (e.g., delete)
 * Swipe right to reveal left actions (e.g., edit)
 */
export function SwipeableCard({
  children,
  leftActions = [],
  rightActions = [],
  onLongPress,
  className = '',
}: SwipeableCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const currentOffset = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isOpen, setIsOpen] = useState<'left' | 'right' | null>(null)

  const leftActionsWidth = leftActions.length * ACTION_WIDTH
  const rightActionsWidth = rightActions.length * ACTION_WIDTH

  const updateTransform = useCallback((offset: number, animate: boolean) => {
    const content = contentRef.current
    if (!content) return

    content.style.transition = animate ? 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'
    content.style.transform = `translateX(${offset}px)`
    currentOffset.current = offset
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Clear any existing long press timer
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchStartTime.current = Date.now()
    isHorizontalSwipe.current = null

    // Remove transition for responsive dragging
    if (contentRef.current) {
      contentRef.current.style.transition = 'none'
    }

    // Start long press timer if callback provided
    if (onLongPress) {
      longPressTimer.current = setTimeout(() => {
        onLongPress()
        longPressTimer.current = null
      }, 500)
    }
  }, [onLongPress])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Cancel long press on any movement
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    const touchX = e.touches[0].clientX
    const touchY = e.touches[0].clientY
    const deltaX = touchX - touchStartX.current
    const deltaY = touchY - touchStartY.current

    // Determine swipe direction on first significant move
    if (isHorizontalSwipe.current === null) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        isHorizontalSwipe.current = Math.abs(deltaX) > Math.abs(deltaY)
      }
      return
    }

    // Not a horizontal swipe, let the page scroll
    if (!isHorizontalSwipe.current) return

    // Calculate the offset based on current state
    let baseOffset = 0
    if (isOpen === 'left') baseOffset = leftActionsWidth
    else if (isOpen === 'right') baseOffset = -rightActionsWidth

    let newOffset = baseOffset + deltaX

    // Apply resistance at boundaries
    const maxLeft = leftActionsWidth
    const maxRight = -rightActionsWidth

    if (newOffset > maxLeft) {
      // Pulling past left actions - apply resistance
      const overshoot = newOffset - maxLeft
      newOffset = maxLeft + overshoot * 0.2
    } else if (newOffset < maxRight) {
      // Pulling past right actions - apply resistance
      const overshoot = maxRight - newOffset
      newOffset = maxRight - overshoot * 0.2
    }

    updateTransform(newOffset, false)
  }, [isOpen, leftActionsWidth, rightActionsWidth, updateTransform])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Cancel long press
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    // If it wasn't a horizontal swipe, do nothing
    if (isHorizontalSwipe.current !== true) {
      isHorizontalSwipe.current = null
      return
    }

    const touchX = e.changedTouches[0].clientX
    const deltaX = touchX - touchStartX.current
    const deltaTime = Date.now() - touchStartTime.current
    const velocity = Math.abs(deltaX) / deltaTime

    const offset = currentOffset.current

    // Determine final state based on position and velocity
    let targetOffset = 0
    let newOpenState: 'left' | 'right' | null = null

    // Quick swipe detection
    if (velocity > VELOCITY_THRESHOLD) {
      if (deltaX > 0 && leftActions.length > 0) {
        targetOffset = leftActionsWidth
        newOpenState = 'left'
      } else if (deltaX < 0 && rightActions.length > 0) {
        targetOffset = -rightActionsWidth
        newOpenState = 'right'
      }
    } else {
      // Position-based detection
      if (offset > SWIPE_THRESHOLD && leftActions.length > 0) {
        targetOffset = leftActionsWidth
        newOpenState = 'left'
      } else if (offset < -SWIPE_THRESHOLD && rightActions.length > 0) {
        targetOffset = -rightActionsWidth
        newOpenState = 'right'
      }
    }

    updateTransform(targetOffset, true)
    setIsOpen(newOpenState)
    isHorizontalSwipe.current = null
  }, [leftActions.length, rightActions.length, leftActionsWidth, rightActionsWidth, updateTransform])

  const handleActionClick = useCallback((action: SwipeAction) => {
    // Close the swipe actions
    updateTransform(0, true)
    setIsOpen(null)
    // Execute the action
    action.onClick()
  }, [updateTransform])

  // Close on click outside (on the card content when open)
  const handleContentClick = useCallback(() => {
    if (isOpen) {
      updateTransform(0, true)
      setIsOpen(null)
    }
  }, [isOpen, updateTransform])

  const getActionColor = (variant: SwipeAction['variant']) => {
    switch (variant) {
      case 'destructive':
        return 'bg-red-500 hover:bg-red-600 text-white'
      case 'warning':
        return 'bg-orange-500 hover:bg-orange-600 text-white'
      case 'primary':
      default:
        return 'bg-primary hover:bg-primary/90 text-primary-foreground'
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
    >
      {/* Left actions (revealed on swipe right) */}
      {leftActions.length > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 flex"
          style={{ width: leftActionsWidth }}
        >
          {leftActions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleActionClick(action)}
              className={`flex flex-col items-center justify-center gap-1 transition-colors ${getActionColor(action.variant)}`}
              style={{ width: ACTION_WIDTH }}
            >
              {action.icon}
              <span className="text-xs font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Right actions (revealed on swipe left) */}
      {rightActions.length > 0 && (
        <div
          className="absolute right-0 top-0 bottom-0 flex"
          style={{ width: rightActionsWidth }}
        >
          {rightActions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleActionClick(action)}
              className={`flex flex-col items-center justify-center gap-1 transition-colors ${getActionColor(action.variant)}`}
              style={{ width: ACTION_WIDTH }}
            >
              {action.icon}
              <span className="text-xs font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      <div
        ref={contentRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleContentClick}
        className="relative bg-card"
        style={{ touchAction: 'pan-y' }}
      >
        {children}
      </div>
    </div>
  )
}
