import { browser } from '$app/env'
import type { SavedEventWithDetails } from '#shared/lib/types.ts'

function dispatchSavedEventsChanged() {
  if (!browser) return
  window.dispatchEvent(new CustomEvent('event-save-changed'))
}

// The server uses the session user and refuses requests from views showing a different account.
async function savedApi<T>(init: RequestInit & { query?: Record<string, string> }): Promise<T> {
  const query = new URLSearchParams(init.query).toString()
  const response = await fetch(`/api/saved${query ? `?${query}` : ''}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
  })
  if (response.status === 409) throw new Error('Account changed during saved-event request')
  if (!response.ok) throw new Error(`Saved-event request failed (${response.status})`)
  return await response.json() as T
}

const expected = (userId?: string): Record<string, string> => (userId ? { expectedUserId: userId } : {})

// Get all saved events for the current user
export async function getSavedEvents(expectedUserId?: string): Promise<SavedEventWithDetails[]> {
  return (await savedApi<{ events: SavedEventWithDetails[] }>({ query: expected(expectedUserId) })).events
}

// Get IDs of all saved events for the current user
export async function getSavedEventIds(): Promise<Set<string>> {
  return new Set((await savedApi<{ events: SavedEventWithDetails[] }>({})).events.map((event) => event.id))
}

// Save an event
export async function saveEvent(eventId: string, expectedUserId?: string): Promise<boolean> {
  await savedApi({ method: 'POST', body: JSON.stringify({ eventId, ...expected(expectedUserId) }) })
  dispatchSavedEventsChanged()
  return true
}

// Unsave an event
export async function unsaveEvent(eventId: string, expectedUserId?: string): Promise<boolean> {
  await savedApi({ method: 'DELETE', body: JSON.stringify({ eventId, ...expected(expectedUserId) }) })
  dispatchSavedEventsChanged()
  return true
}

// Check if a specific event is saved
export async function isEventSaved(eventId: string, expectedUserId?: string): Promise<boolean> {
  const { savedIds } = await savedApi<{ savedIds: string[] }>({ query: { ids: eventId, ...expected(expectedUserId) } })
  return savedIds.includes(eventId)
}
