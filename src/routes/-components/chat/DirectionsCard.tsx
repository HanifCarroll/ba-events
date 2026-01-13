import { MapPin, Navigation, ExternalLink } from 'lucide-react'
import { track } from '@/lib/analytics'
import type { DirectionsData } from '@/shared/lib/types'

interface DirectionsCardProps {
  directions: DirectionsData
}

export function DirectionsCard({ directions }: DirectionsCardProps) {
  const { venueName, address, mapsUrl, eventName } = directions

  const handleOpenMaps = () => {
    track('chat:directions_opened', {
      venue_name: venueName,
      has_event: !!eventName,
    })
  }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/5 shadow-md transition-all duration-300 hover:border-primary/50 hover:shadow-lg">
      {/* Decorative glow */}
      <div className="absolute -top-12 -right-12 w-24 h-24 bg-primary/10 rounded-full blur-2xl opacity-60 group-hover:opacity-80 transition-opacity" />

      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/40 via-primary to-primary/40" />

      <div className="relative p-4">
        {/* Header with icon */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-2.5 rounded-lg bg-primary/15 border border-primary/20">
            <Navigation className="h-5 w-5 text-primary" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Event name if available */}
            {eventName && (
              <p className="text-xs text-primary font-medium mb-1 truncate">
                Directions to event
              </p>
            )}

            {/* Venue name */}
            <h4 className="font-display font-semibold text-lg text-foreground leading-tight">
              {venueName}
            </h4>

            {/* Address */}
            <div className="flex items-start gap-2 mt-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-primary/60" />
              <span className="leading-relaxed">{address}</span>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleOpenMaps}
          className="group/btn flex items-center justify-center gap-2 w-full mt-4 px-4 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 transition-all duration-200"
        >
          <Navigation className="h-4 w-4" />
          Open in Google Maps
          <ExternalLink className="h-3.5 w-3.5 opacity-70 group-hover/btn:translate-x-0.5 transition-transform" />
        </a>
      </div>
    </div>
  )
}
