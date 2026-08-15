import { useEffect, useState } from 'react'
import { Heart } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'
import { isEventSaved, saveEvent, unsaveEvent } from '@/features/chat/lib/saved'
import { track } from '@/lib/analytics'
import { Button } from '@/shared/ui/button'
import * as m from '@/paraglide/messages'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/tooltip'

interface SaveEventButtonProps {
  eventId: string
  /** Event name for analytics tracking */
  eventName?: string
  initialSaved?: boolean
  onSaveChange?: (saved: boolean) => void
  size?: 'sm' | 'md'
  className?: string
  /** Show a text label beside the icon. */
  showLabel?: boolean
  /** Source context for analytics */
  source?: 'chat' | 'saved_page' | 'event_detail'
}

export function SaveEventButton({
  eventId,
  eventName,
  initialSaved = false,
  onSaveChange,
  size = 'md',
  className = '',
  showLabel = false,
  source = 'chat',
}: SaveEventButtonProps) {
  const { user, loading } = useAuthContext()
  const [isSaved, setIsSaved] = useState(initialSaved)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (!user) {
      setIsSaved(false)
      return
    }

    void isEventSaved(eventId)
      .then((saved) => {
        if (!cancelled) {
          setIsSaved(saved)
        }
      })
      .catch((error) => {
        console.error('Failed to load saved state:', error)
      })

    return () => {
      cancelled = true
    }
  }, [eventId, user])

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
        track('event:saved', { event_id: eventId, event_name: eventName, source })
      } else {
        await unsaveEvent(eventId)
        track('event:unsaved', { event_id: eventId, event_name: eventName, source })
      }
      onSaveChange?.(newSavedState)
    } catch (error) {
      // Revert on error
      setIsSaved(!newSavedState)
      console.error('Failed to update saved state:', error)
      toast.error('Failed to update saved status')
    } finally {
      setIsUpdating(false)
    }
  }

  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const buttonSize = showLabel
    ? size === 'sm'
      ? 'h-9 px-3'
      : 'h-11 w-full px-3'
    : size === 'sm'
      ? 'h-8 w-8'
      : 'h-10 w-10'

  // If loading, show disabled state
  if (loading) {
    return (
      <Button
        variant="ghost"
        size={showLabel ? 'default' : 'icon'}
        disabled
        aria-label={m.event_loading_saved()}
        className={`${buttonSize} text-muted-foreground/50 ${className}`}
      >
        <Heart className={iconSize} />
        {showLabel && <span>{m.event_save()}</span>}
      </Button>
    )
  }

  // If not logged in, show tooltip prompting to sign in (icon-only only)
  if (!user) {
    const signInButton = (
      <Button
        asChild
        variant="ghost"
        size={showLabel ? 'default' : 'icon'}
        className={`${buttonSize} text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors ${className}`}
      >
        <Link
          to="/login"
          aria-label={m.event_sign_in_to_save()}
        >
          <Heart className={iconSize} />
          {showLabel && <span>{m.event_save()}</span>}
        </Link>
      </Button>
    )

    if (showLabel) return signInButton

    return (
      <Tooltip>
        <TooltipTrigger asChild>{signInButton}</TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{m.event_sign_in_to_save()}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  const toggleButton = (
    <Button
      variant="ghost"
      size={showLabel ? 'default' : 'icon'}
      onClick={handleToggle}
      disabled={isUpdating}
      aria-label={isSaved ? m.event_remove_from_saved() : m.event_save()}
      aria-pressed={isSaved}
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
      {showLabel && <span>{isSaved ? m.event_saved() : m.event_save()}</span>}
    </Button>
  )

  if (showLabel) return toggleButton

  return (
    <Tooltip>
      <TooltipTrigger asChild>{toggleButton}</TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{isSaved ? m.event_remove_from_saved() : m.event_save()}</p>
      </TooltipContent>
    </Tooltip>
  )
}
