import { createServerFn } from '@tanstack/react-start'
import { getVenues, getEventsWithVenues } from '../supabase'

export const getAdminStats = createServerFn({ method: 'GET' }).handler(async () => {
  const [venues, events] = await Promise.all([
    getVenues(1000),
    getEventsWithVenues(1000),
  ])

  const now = new Date()
  const upcomingEvents = events.filter(e => new Date(e.starts_at) > now)
  const scheduledEvents = events.filter(e => e.status === 'scheduled')

  return {
    venueCount: venues.length,
    eventCount: events.length,
    upcomingCount: upcomingEvents.length,
    scheduledCount: scheduledEvents.length,
  }
})
