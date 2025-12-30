import { useState, useEffect } from 'react'
import { Heart } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useAuthContext } from '@/hooks/useAuthContext'
import { saveEvent, unsaveEvent } from '@/lib/saved-events'
import { track } from '@/lib/analytics'
import { Button } from './ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip'

interface SaveEventButtonProps {
  eventId: string
  initialSaved?: boolean
  onSaveChange?: (saved: boolean) => void
  size?: 'sm' | 'md'
  className?: string
  /** Source context for analytics */
  source?: 'chat' | 'saved_page'
}

export function SaveEventButton({
  eventId,
  initialSaved = false,
  onSaveChange,
  size = 'md',
  className = '',
  source = 'chat',
}: SaveEventButtonProps) {
  const { user, loading } = useAuthContext()
  const [isSaved, setIsSaved] = useState(initialSaved)
  const [isUpdating, setIsUpdating] = useState(false)

  // Sync with prop changes
  useEffect(() => {
    setIsSaved(initialSaved)
  }, [initialSaved])

  const handleToggle = async () => {
    if (!user) return
    if (isUpdating) return

    setIsUpdating(true)
    const newSavedState = !isSaved

    // Optimistic update
    setIsSaved(newSavedState)

    try {
      if (newSavedState) {
        await saveEvent(eventId)
        track('event:saved', { event_id: eventId, source })
      } else {
        await unsaveEvent(eventId)
        track('event:unsaved', { event_id: eventId, source })
      }
      onSaveChange?.(newSavedState)
    } catch (error) {
      // Revert on error
      setIsSaved(!newSavedState)
      console.error('Failed to update saved state:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const buttonSize = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'

  // If loading, show disabled state
  if (loading) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        className={`${buttonSize} text-muted-foreground/50 ${className}`}
      >
        <Heart className={iconSize} />
      </Button>
    )
  }

  // If not logged in, show tooltip prompting to sign in
  if (!user) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to="/login">
            <Button
              variant="ghost"
              size="icon"
              className={`${buttonSize} text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors ${className}`}
            >
              <Heart className={iconSize} />
            </Button>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">Sign in to save events</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleToggle}
          disabled={isUpdating}
          className={`
            ${buttonSize}
            transition-all duration-200
            ${isSaved
              ? 'text-primary hover:text-primary/80 hover:bg-primary/10'
              : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
            }
            ${isUpdating ? 'opacity-50' : ''}
            ${className}
          `}
        >
          <Heart
            className={`${iconSize} transition-all duration-200 ${isSaved ? 'fill-current scale-110' : ''}`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{isSaved ? 'Remove from saved' : 'Save event'}</p>
      </TooltipContent>
    </Tooltip>
  )
}
