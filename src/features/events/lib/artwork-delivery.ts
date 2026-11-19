export const ARTWORK_WIDTHS = [320, 640, 1280] as const
export const HOME_ARTWORK_SIZES = '(min-width: 1440px) 427px, (min-width: 1024px) calc((100vw - 160px) / 3), (min-width: 640px) calc((100vw - 84px) / 2), calc(100vw - 32px)'

// Exact CDN hosts and media paths; no wildcard suffixes, arbitrary hosts or redirects.
const IMAGE_PATHS: Record<string, RegExp> = {
  'imagenes.passline.com': /^\/eventos\//,
  'images.venti.live': /^\/user-images\//,
  'secure.meetupstatic.com': /^\/photos\/event\//,
  'img.evbuc.com': /^\/(?:https%3A%2F%2Fcdn\.evbuc\.com%2Fimages%2F|https:\/\/cdn\.evbuc\.com\/images\/)/i,
  'cdn.evbuc.com': /^\/images\//,
  'images.lumacdn.com': /^\/(?:uploads|event-covers)\//,
}

/** The R2 key of an artwork URL in the copy tool's and the D1 intake's form, `https://baeventos.com/api/event-artwork/<event id>/<sha256>.<ext>`. */
const R2_ARTWORK = /^https:\/\/baeventos\.com\/api\/event-artwork\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{64}\.(?:jpg|png|webp))$/
export const R2_ARTWORK_KEY = /^[0-9a-f]{64}\.(?:jpg|png|webp)$/

/** The R2 artwork key `value` names, or null. With `eventId`, only the key of that event's own URL. */
export function r2ArtworkKey(value: string, eventId?: string): string | null {
  const match = R2_ARTWORK.exec(value)
  return match && (!eventId || match[1] === eventId.toLowerCase()) ? match[2] : null
}

export function isArtworkOriginAllowed(value: string, ownedStorageOrigin?: string): boolean {
  if (r2ArtworkKey(value)) return true
  try {
    const url = new URL(value)
    const owned = ownedStorageOrigin && url.origin === new URL(ownedStorageOrigin).origin &&
      /^\/storage\/v1\/object\/public\/event-artwork\/[0-9a-f]{64}\.(jpg|png|webp)$/.test(url.pathname) && !url.search
    return value.length <= 4096 && url.protocol === 'https:' && !url.username && !url.password &&
      !url.port && !url.hash && (!!IMAGE_PATHS[url.hostname]?.test(url.pathname) || !!owned)
  } catch { return false }
}

/** Version invalidates the derived URL when a catalog artwork URL changes; not an authorization token. */
export function artworkVersion(url: string): string {
  let hash = 2166136261
  for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

export function artworkUrl(id: string, imageUrl: string, width: typeof ARTWORK_WIDTHS[number]): string {
  return `/api/event-artwork/${encodeURIComponent(id)}/${width}.webp?v=${artworkVersion(imageUrl)}`
}

export function artworkSrcset(id: string, imageUrl: string, imageWidth?: number | null): string {
  const seen = new Set<number>()
  return ARTWORK_WIDTHS.flatMap((width) => {
    const actualWidth = imageWidth && Number.isInteger(imageWidth) && imageWidth > 0 ? Math.min(width, imageWidth) : width
    if (seen.has(actualWidth)) return []
    seen.add(actualWidth)
    return [`${artworkUrl(id, imageUrl, width)} ${actualWidth}w`]
  }).join(', ')
}
