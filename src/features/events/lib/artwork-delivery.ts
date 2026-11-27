import { isExternalArtworkOriginAllowed } from '#shared/lib/artwork-origins.ts'
import { eventArtworkPath, isPublicOriginalArtworkUrl } from '#shared/lib/artwork-url.ts'

export const ARTWORK_WIDTHS = [320, 640, 1280] as const
export const HOME_ARTWORK_SIZES = '(width < 768px) 96px, (min-width: 1440px) 243.2px, (min-width: 1024px) calc((100vw - 192px) / 4), calc((100vw - 104px) / 3)'

export function isResponsiveArtworkUrl(eventId: string, url: string): boolean {
  return isPublicOriginalArtworkUrl(eventId, url) || isExternalArtworkOriginAllowed(url)
}

/** Version invalidates the derived URL when a catalog artwork URL changes; not an authorization token. */
export function artworkVersion(url: string): string {
  let hash = 2166136261
  for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

export function artworkUrl(id: string, imageUrl: string, width: typeof ARTWORK_WIDTHS[number]): string {
  return `${eventArtworkPath(id, `${width}.webp`)}?v=${artworkVersion(imageUrl)}`
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
