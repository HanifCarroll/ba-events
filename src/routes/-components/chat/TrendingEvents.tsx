import { Calendar, MapPin, Clock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import * as m from '@/paraglide/messages'
import { getTrendingEventsAction } from '@/features/events/api/crud'
import { queryKeys } from '@/shared/lib/query'
import { formatPrice } from '@/features/chat/lib/messages'
import { formatShortDate, formatTime } from '@/shared/lib/utils/formatting'
import { track } from '@/lib/analytics'
import type { ChatEventPayload } from '@/shared/lib/types'

interface TrendingEventsProps {
  /** @param options.eventId exact event tapped — sent server-side, hidden from chat text */
  onSelectPrompt: (prompt: string, options?: { eventId?: string }) => void
  /** Prefetched events from the route loader, used as the query's initial data. */
  initialEvents?: ChatEventPayload[]
}

/**
 * "Happening soon" grid of eight real upcoming events on the chat home screen.
 * Each card is a starter prompt: tapping it asks the concierge about that event.
 * Hidden entirely when there are no events to show.
 */
export function TrendingEvents({ onSelectPrompt, initialEvents }: TrendingEventsProps) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.events.trending(),
    queryFn: () => getTrendingEventsAction(),
    staleTime: 5 * 60 * 1000,
    // Route loaders prefetch trending events (serialized across SSR→client),
    // so seed the query with them — the grid renders on first paint without a
    // skeleton flash, while useQuery still owns staleness/refetch.
    initialData: initialEvents,
    initialDataUpdatedAt: initialEvents ? Date.now() : undefined,
  })

  const events = data ?? []

  if (!isLoading && events.length === 0) return null

  return (
    <section className="mt-6 border-t border-border/60 pt-4" aria-label={m.home_trending_title()}>
      <h2 className="mb-3 text-sm font-medium text-foreground">{m.home_trending_title()}</h2>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:pb-0">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-[72%] max-w-[300px] shrink-0 overflow-hidden rounded-xl border border-border/50 bg-card animate-pulse sm:w-auto sm:max-w-none"
            >
              <div className="h-24 bg-muted" />
              <div className="space-y-2 p-3">
                <div className="h-3.5 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="flex touch-pan-x snap-x snap-mandatory gap-3 overflow-x-auto overscroll-contain pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:touch-auto sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:overscroll-auto sm:snap-none sm:pb-0 stagger-children"
        >
          {events.map((event) => (
            <TrendingEventCard key={event.id} event={event} onSelectPrompt={onSelectPrompt} />
          ))}
        </div>
      )}
    </section>
  )
}

function TrendingEventCard({
  event,
  onSelectPrompt,
}: {
  event: ChatEventPayload
  onSelectPrompt: (prompt: string, options?: { eventId?: string }) => void
}) {
  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = formatTime(startDate)
  const showPrice = event.is_free || event.price !== null

  const handleClick = () => {
    track('home:trending_clicked', {
      event_id: event.id,
      event_name: event.name,
    })
    onSelectPrompt(m.home_trending_prompt({ name: event.name }), { eventId: event.id })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group flex w-[72%] max-w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border/50 bg-card text-left transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:max-w-none"
    >
      {event.image_url ? (
        <img
          src={event.image_url}
          alt=""
          loading="lazy"
          className="h-24 w-full object-cover"
        />
      ) : (
        <div className="flex h-24 items-center justify-center bg-muted text-muted-foreground/60">
          <Calendar className="h-6 w-6" aria-hidden="true" />
        </div>
      )}
      <div className="p-3">
        <p className="line-clamp-1 text-sm font-medium text-foreground transition-colors group-hover:text-primary">
          {event.name}
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0 text-primary/60" aria-hidden="true" />
          <span className="truncate">{event.venue_neighborhood || event.venue_name}</span>
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0 text-primary/60" aria-hidden="true" />
          <span>
            {dateStr} · {timeStr}
          </span>
        </p>
        {showPrice && (
          <p className="mt-1.5 text-xs font-medium text-primary">{formatPrice(event.price, event.is_free)}</p>
        )}
      </div>
    </button>
  )
}
