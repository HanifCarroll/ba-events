import { useState } from 'react'
import { Share2, Heart, Ticket, MapPin, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toggleFavorite, isFavorite } from '@/lib/chat'
import type { EventWithVenue } from '@/lib/types'

interface EventActionsProps {
  event: EventWithVenue
}

export function EventActions({ event }: EventActionsProps) {
  const [saved, setSaved] = useState(() => isFavorite(event.id))
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    const shareUrl = event.link || window.location.href
    const shareText = `Check out ${event.name} at ${event.venue_name}`

    if (navigator.share) {
      try {
        await navigator.share({
          title: event.name,
          text: shareText,
          url: shareUrl,
        })
      } catch {
        // User cancelled or share failed, fall back to copy
        await copyToClipboard(shareUrl)
      }
    } else {
      await copyToClipboard(shareUrl)
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
    const url = event.ticket_url || event.link
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleMap = () => {
    const address = event.venue_address || event.venue_name
    if (address) {
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address + ', Buenos Aires, Argentina')}`
      window.open(mapsUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <TooltipProvider>
      <div className="flex gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleShare}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
              <span className="sr-only">Share</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{copied ? 'Copied!' : 'Share'}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleSave}
            >
              <Heart
                className={`h-4 w-4 ${saved ? 'fill-red-500 text-red-500' : ''}`}
              />
              <span className="sr-only">Save</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{saved ? 'Saved!' : 'Save'}</p>
          </TooltipContent>
        </Tooltip>

        {(event.ticket_url || event.link) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleTickets}
              >
                <Ticket className="h-4 w-4" />
                <span className="sr-only">Get tickets</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Get tickets</p>
            </TooltipContent>
          </Tooltip>
        )}

        {(event.venue_address || event.venue_name) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleMap}
              >
                <MapPin className="h-4 w-4" />
                <span className="sr-only">View on map</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>View on map</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}
