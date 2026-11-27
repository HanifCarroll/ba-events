// Exact catalog CDN hosts and media paths. Byte fetchers check each URL before requesting it.
const IMAGE_PATHS: Record<string, RegExp> = {
  'imagenes.passline.com': /^\/eventos\//,
  'images.venti.live': /^\/user-images\//,
  'secure.meetupstatic.com': /^\/photos\/event\//,
  'img.evbuc.com': /^\/(?:https%3A%2F%2Fcdn\.evbuc\.com%2Fimages%2F|https:\/\/cdn\.evbuc\.com\/images\/)/i,
  'cdn.evbuc.com': /^\/images\//,
  'images.lumacdn.com': /^\/(?:uploads|event-covers)\//,
}

export function isExternalArtworkOriginAllowed(value: string, ownedStorageOrigin?: string): boolean {
  try {
    const url = new URL(value)
    const owned = ownedStorageOrigin && url.origin === new URL(ownedStorageOrigin).origin &&
      /^\/storage\/v1\/object\/public\/event-artwork\/[0-9a-f]{64}\.(jpg|png|webp)$/.test(url.pathname) && !url.search
    return value.length <= 4096 && url.protocol === 'https:' && !url.username && !url.password &&
      !url.port && !url.hash && (!!IMAGE_PATHS[url.hostname]?.test(url.pathname) || !!owned)
  } catch { return false }
}
