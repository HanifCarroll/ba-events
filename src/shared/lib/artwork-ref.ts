/** The catalog's two Event Image sources, persisted in the existing `events.image_url` column. */
export type ArtworkRef =
  | { kind: 'external'; url: string }
  | { kind: 'stored'; key: string; contentType: string }

const STORED = 'r2:'
const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const
const KEY = /^[0-9a-f]{64}\.(jpg|png|webp)$/
// Frozen compatibility reader for rows written by the D1 copy tool and earlier intake.
const LEGACY = /^https:\/\/baeventos\.com\/api\/event-artwork\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^/]+)$/

function contentTypeForKey(key: string): string | undefined {
  const match = KEY.exec(key)
  return match?.[0] === key ? CONTENT_TYPES[match[1] as keyof typeof CONTENT_TYPES] : undefined
}

export const isStoredArtworkKey = (key: string): boolean => contentTypeForKey(key) !== undefined

export function encodeArtworkRef(reference: ArtworkRef): string {
  if (reference.kind === 'external') return reference.url
  if (contentTypeForKey(reference.key) !== reference.contentType) throw new Error('Invalid stored artwork key or content type')
  return `${STORED}${reference.contentType}:${reference.key}`
}

/** External values pass through verbatim. Each byte-fetching adapter applies its own origin policy. */
export function decodeArtworkRef(value: string | null | undefined, eventId: string): ArtworkRef | null {
  if (value == null) return null
  if (value.startsWith(STORED)) {
    const [, contentType, key, extra] = value.split(':', 4)
    return key && contentType && extra === undefined && contentTypeForKey(key) === contentType ? { kind: 'stored', key, contentType } : null
  }
  const legacy = LEGACY.exec(value)
  // Never interpret another event's legacy URL as authority to serve its key for this event.
  if (legacy && legacy[1] === eventId.toLowerCase()) {
    const key = legacy[2]!
    const contentType = contentTypeForKey(key)
    if (contentType) return { kind: 'stored', key, contentType }
  }
  return { kind: 'external', url: value }
}
