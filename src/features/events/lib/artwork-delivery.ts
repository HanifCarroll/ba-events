export const ARTWORK_WIDTHS = [320, 640, 1280] as const
export const HOME_ARTWORK_SIZES = '(min-width: 1280px) 288px, (min-width: 640px) calc((100vw - 128px) / 4), 220px'

// Exact CDN hosts and media paths; no wildcard suffixes, arbitrary hosts or redirects.
const IMAGE_PATHS: Record<string, RegExp> = {
  'imagenes.passline.com': /^\/eventos\//,
  'images.venti.live': /^\/user-images\//,
  'secure.meetupstatic.com': /^\/photos\/event\//,
  'img.evbuc.com': /^\/(?:https%3A%2F%2Fcdn\.evbuc\.com%2Fimages%2F|https:\/\/cdn\.evbuc\.com\/images\/)/i,
  'cdn.evbuc.com': /^\/images\//,
  'images.lumacdn.com': /^\/(?:uploads|event-covers)\//,
}

export function isArtworkOriginAllowed(value: string): boolean {
  try {
    const url = new URL(value)
    return value.length <= 4096 && url.protocol === 'https:' && !url.username && !url.password &&
      !url.port && !url.hash && !!IMAGE_PATHS[url.hostname]?.test(url.pathname)
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

export function artworkSrcset(id: string, imageUrl: string): string {
  return ARTWORK_WIDTHS.map((width) => `${artworkUrl(id, imageUrl, width)} ${width}w`).join(', ')
}
