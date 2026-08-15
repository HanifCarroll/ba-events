import { browser } from '$app/env'

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

export function getSiteUrl(): string {
  if (browser && window.location?.origin) {
    return window.location.origin
  }

  return 'https://baeventos.com'
}

export function resolveSiteUrl(path: string): string {
  if (/^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(path)) {
    return path
  }

  const base = getSiteUrl()
  if (path.startsWith('/')) {
    return `${base}${path}`
  }

  return `${base}/${path}`
}

export function getEventUrl(id: string): string {
  return `${getSiteUrl()}/events/${id}`
}
