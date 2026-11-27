import { decodeArtworkRef, isStoredArtworkKey, type ArtworkRef } from './artwork-ref.ts'

export const ARTWORK_PUBLIC_ORIGIN = 'https://baeventos.com'

export function isArtworkEventId(id: string): boolean {
  return id.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

export function eventArtworkPath(eventId: string, variant: string): string {
  return `/api/event-artwork/${encodeURIComponent(eventId)}/${variant}`
}

/** Stable public transport for both web clients and the out-of-Worker publisher. */
export function publicArtworkUrl(eventId: string, reference: ArtworkRef): string {
  return reference.kind === 'external' ? reference.url : ARTWORK_PUBLIC_ORIGIN + eventArtworkPath(eventId, reference.key)
}

/** Project catalog storage to the existing URL-only public event payloads. */
export function catalogArtworkUrl(eventId: string, value: string | null): string | null {
  const reference = decodeArtworkRef(value, eventId)
  return reference && publicArtworkUrl(eventId, reference)
}

export function isPublicOriginalArtworkUrl(eventId: string, url: string): boolean {
  const key = url.slice(url.lastIndexOf('/') + 1)
  return isStoredArtworkKey(key) && url === ARTWORK_PUBLIC_ORIGIN + eventArtworkPath(eventId, key)
}
