import { useState } from 'react'
import { Share2, Heart, Ticket, MapPin, Check } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/ui/tooltip'
import { toggleFavorite, isFavorite } from '@/features/chat'
import { track } from '@/lib/analytics'
import type { EventWithVenue } from '@/shared/lib/types'

interface EventActionsProps {
  event: EventWithVenue
  shareUrl?: string
}

export function EventActions({ event, shareUrl }: EventActionsProps) {
  const [saved, setSaved] = useState(() => isFavorite(event.id))
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    const shareTarget = shareUrl || event.link || window.location.href
    const shareText = `Check out ${event.name} at ${event.venue_name}`

    if (navigator.share) {
      try {
        await navigator.share({
          title: event.name,
          text: shareText,
          url: shareTarget,
        })
      } catch {
        // User canceled or share failed, fall back to copy
        await copyToClipboard(shareTarget)
      }
    } else {
      await copyToClipboard(shareTarget)
    }
  }

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSave = () => {
    const nowSaved = toggleFavorite(event.id)
    setSaved(nowSaved)
  }

  const handleTickets = () => {
    if (event.ticket_url) {
      track('event:link_clicked', { event_id: event.id, event_name: event.name, link_type: 'ticket' })
      window.open(event.ticket_url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleMap = () => {
    const address = event.venue_address || event.venue_name
    if (address) {
      track('event:link_clicked', { event_id: event.id, event_name: event.name, link_type: 'map' })
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address + ', Buenos Aires, Argentina')}`
      window.open(mapsUrl, '_blank', 'noopener,noreferrer')
    }
  }

  const actionButtonClass = `
    p-2 rounded-lg transition-all duration-200
    text-muted-foreground hover:text-primary hover:bg-primary/10
    focus:outline-none focus:ring-2 focus:ring-ring
  `

  return (
    <TooltipProvider>
      <div className="flex gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={actionButtonClass}
              onClick={handleShare}
            >
              {copied ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
              <span className="sr-only">Share</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-card border border-border/50 text-foreground">
            <p className="text-xs">{copied ? 'Copied!' : 'Share'}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={actionButtonClass}
              onClick={handleSave}
            >
              <Heart
                className={`h-4 w-4 transition-colors duration-200 ${
                  saved ? 'fill-accent text-accent' : ''
                }`}
              />
              <span className="sr-only">Save</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-card border border-border/50 text-foreground">
            <p className="text-xs">{saved ? 'Saved!' : 'Save'}</p>
          </TooltipContent>
        </Tooltip>

        {event.ticket_url && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={actionButtonClass}
                onClick={handleTickets}
              >
                <Ticket className="h-4 w-4" />
                <span className="sr-only">Get tickets</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="bg-card border border-border/50 text-foreground">
              <p className="text-xs">Get tickets</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Don't show map button when address is hidden */}
        {!event.location_hidden && (event.venue_address || event.venue_name) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={actionButtonClass}
                onClick={handleMap}
              >
                <MapPin className="h-4 w-4" />
                <span className="sr-only">View on map</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="bg-card border border-border/50 text-foreground">
              <p className="text-xs">View on map</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}
