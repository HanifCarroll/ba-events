import { useState, useEffect, useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Bookmark, Calendar, Clock, ArrowLeft, Sparkles } from 'lucide-react'
import { useAuthContext } from '@/hooks/useAuthContext'
import { getSavedEvents } from '@/lib/saved-events'
import { EventCard } from '@/components/events/EventCard'
import { Button } from '@/components/ui/button'
import type { EventWithVenue } from '@/lib/types'
import * as m from '@/paraglide/messages'
import { requireAuth } from '@/lib/session'

export const Route = createFileRoute('/saved')({
  beforeLoad: async () => {
    await requireAuth({ data: { redirectTo: '/saved' } })
  },
  component: SavedEventsPage,
})

function SavedEventsPage() {
  const { user } = useAuthContext()
  const [events, setEvents] = useState<EventWithVenue[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming')

  // Fetch saved events
  useEffect(() => {
    if (user) {
      setLoading(true)
      getSavedEvents()
        .then(setEvents)
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [user])

  // Listen for save/unsave events to refresh the list
  useEffect(() => {
    const handleSaveChange = () => {
      if (user) {
        getSavedEvents().then(setEvents)
      }
    }
    window.addEventListener('event-save-changed', handleSaveChange)
    return () => window.removeEventListener('event-save-changed', handleSaveChange)
  }, [user])

  const now = new Date()
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const eventDate = new Date(event.starts_at)
      if (filter === 'upcoming') {
        return eventDate >= now
      }
      return eventDate < now
    })
  }, [events, filter, now])

  const upcomingCount = events.filter((e) => new Date(e.starts_at) >= now).length
  const pastCount = events.filter((e) => new Date(e.starts_at) < now).length

  // Guard against edge case where context hasn't synced yet
  if (!user) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        {/* Art deco inspired pattern */}
        <div className="absolute top-20 right-10 w-32 h-32 opacity-[0.03]">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <path d="M50 0 L100 50 L50 100 L0 50 Z" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
            <path d="M50 20 L80 50 L50 80 L20 50 Z" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
            <path d="M50 40 L60 50 L50 60 L40 50 Z" fill="currentColor" className="text-primary" />
          </svg>
        </div>
      </div>

      {/* Header */}
      <div className="relative px-6 py-6 border-b border-border/30">
        <div className="max-w-4xl mx-auto">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            {m.saved_back()}
          </Link>

          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Bookmark className="h-5 w-5 text-primary" />
                </div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  {m.saved_title()}
                </h1>
              </div>
              <p className="text-muted-foreground text-sm">
                {events.length === 0 ? (
                  m.saved_none()
                ) : events.length === 1 ? (
                  m.saved_count({ count: events.length })
                ) : (
                  m.saved_count_plural({ count: events.length })
                )}
              </p>
            </div>
          </div>

          {/* Filter tabs */}
          {events.length > 0 && (
            <div className="flex gap-1 mt-6 p-1 bg-card/30 rounded-lg border border-border/30 w-fit">
              <button
                onClick={() => setFilter('upcoming')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  filter === 'upcoming'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Calendar className="h-4 w-4" />
                {m.saved_upcoming()}
                {upcomingCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-primary/20 text-primary">
                    {upcomingCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setFilter('past')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  filter === 'past'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Clock className="h-4 w-4" />
                {m.saved_past()}
                {pastCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-muted-foreground/20 text-muted-foreground">
                    {pastCount}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-auto px-6 py-6">
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-muted-foreground">{m.saved_loading()}</p>
            </div>
          ) : events.length === 0 ? (
            <EmptyState />
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted/30 mb-4">
                {filter === 'upcoming' ? (
                  <Calendar className="h-8 w-8 text-muted-foreground" />
                ) : (
                  <Clock className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <h3 className="font-display text-lg font-medium mb-2">
                {filter === 'upcoming' ? m.saved_no_upcoming() : m.saved_no_past()}
              </h3>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                {filter === 'upcoming'
                  ? m.saved_no_upcoming_desc()
                  : m.saved_no_past_desc()}
              </p>
              {filter === 'upcoming' && (
                <Link to="/">
                  <Button variant="outline" className="mt-4">
                    {m.saved_discover()}
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3 animate-fade-in-up">
              {filteredEvents.map((event, index) => (
                <EventCard key={event.id} event={event} position={index} source="saved_page" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="relative text-center py-20">
      {/* Decorative elements */}
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.02] pointer-events-none">
        <svg viewBox="0 0 200 200" className="w-80 h-80">
          <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-primary" />
          <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-primary" />
          <circle cx="100" cy="100" r="50" fill="none" stroke="currentColor" strokeWidth="0.2" className="text-primary" />
          <circle cx="100" cy="100" r="30" fill="none" stroke="currentColor" strokeWidth="0.1" className="text-primary" />
        </svg>
      </div>

      <div className="relative">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20 mb-6">
          <Bookmark className="h-10 w-10 text-primary/80" />
        </div>

        <h2 className="font-display text-2xl font-semibold mb-3">
          {m.saved_empty_title()}
        </h2>
        <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-6">
          {m.saved_empty_desc()}
        </p>

        <Link to="/">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Sparkles className="mr-2 h-4 w-4" />
            {m.saved_discover()}
          </Button>
        </Link>

        {/* Decorative bottom element */}
        <div className="flex items-center justify-center gap-2 mt-10">
          <div className="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <div className="w-1.5 h-1.5 rounded-full bg-primary/30" />
          <div className="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>
      </div>
    </div>
  )
}
