import { getSupabaseBrowserClient } from '@/features/auth/api/client'
import type { SavedEventWithDetails } from '@/shared/lib/types'

function dispatchSavedEventsChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('event-save-changed'))
}

function mapSavedEventRow(item: any): SavedEventWithDetails | null {
  if (!item.events) return null
  const event = item.events
  return {
    ...event,
    venue_name: event.venues?.name || null,
    venue_address: event.venues?.address || null,
    venue_neighborhood: event.venues?.neighborhood || null,
    saved_at: item.created_at,
  }
}

// Get all saved events for the current user
export async function getSavedEvents(): Promise<SavedEventWithDetails[]> {
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
    .map(mapSavedEventRow)
    .filter((event: SavedEventWithDetails | null): event is SavedEventWithDetails => event !== null)
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
      dispatchSavedEventsChanged()
      return true
    }
    console.error('Error saving event:', error)
    throw error
  }

  dispatchSavedEventsChanged()
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

  dispatchSavedEventsChanged()
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
    console.error('Error checking saved event:', error)
    return false
  }

  return data !== null
}
