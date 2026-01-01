import { getSupabaseBrowserClient } from '@/features/auth'
import type { EventWithVenue } from '@/shared/lib/types'

// Get all saved events for the current user
export async function getSavedEvents(): Promise<EventWithVenue[]> {
  const client = getSupabaseBrowserClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) {
    return []
  }

  // Query saved_events joined with events and venues
  const { data, error } = await (client
    .from('saved_events')
    .select(`
      id,
      event_id,
      created_at,
      events (
        *,
        venues (*)
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false }) as any)

  if (error) {
    console.error('Error fetching saved events:', error)
    return []
  }

  // Transform the nested data to match EventWithVenue type
  return (data || [])
    .map((item: any) => {
      if (!item.events) return null
      const event = item.events
      return {
        ...event,
        venue_name: event.venues?.name || null,
        venue_address: event.venues?.address || null,
        venue_neighborhood: event.venues?.neighborhood || null,
        venue_latitude: event.venues?.latitude || null,
        venue_longitude: event.venues?.longitude || null,
      }
    })
    .filter((event: any) => event !== null) as EventWithVenue[]
}

// Get IDs of all saved events for the current user
export async function getSavedEventIds(): Promise<Set<string>> {
  const client = getSupabaseBrowserClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) {
    return new Set()
  }

  const { data, error } = await (client
    .from('saved_events')
    .select('event_id')
    .eq('user_id', user.id) as any)

  if (error) {
    console.error('Error fetching saved event IDs:', error)
    return new Set()
  }

  return new Set((data || []).map((item: any) => item.event_id))
}

// Save an event
export async function saveEvent(eventId: string): Promise<boolean> {
  const client = getSupabaseBrowserClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) {
    throw new Error('Must be logged in to save events')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client.from('saved_events') as any).insert({
    user_id: user.id,
    event_id: eventId,
  })
  const { error } = result

  if (error) {
    // Ignore duplicate errors (already saved)
    if (error.code === '23505') {
      return true
    }
    console.error('Error saving event:', error)
    throw error
  }

  return true
}

// Unsave an event
export async function unsaveEvent(eventId: string): Promise<boolean> {
  const client = getSupabaseBrowserClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) {
    throw new Error('Must be logged in to unsave events')
  }

  const { error } = await (client
    .from('saved_events')
    .delete()
    .eq('user_id', user.id)
    .eq('event_id', eventId) as any)

  if (error) {
    console.error('Error unsaving event:', error)
    throw error
  }

  return true
}

// Check if a specific event is saved
export async function isEventSaved(eventId: string): Promise<boolean> {
  const client = getSupabaseBrowserClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) {
    return false
  }

  const { data, error } = await (client
    .from('saved_events')
    .select('id')
    .eq('user_id', user.id)
    .eq('event_id', eventId)
    .maybeSingle() as any)

  if (error) {
    console.error('Error checking if event is saved:', error)
    return false
  }

  return data !== null
}
