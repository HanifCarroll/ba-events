export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

export function getSiteUrl(): string {
  const envUrl = import.meta.env.VITE_PUBLIC_SITE_URL
  if (envUrl && envUrl.trim().length > 0) {
    return normalizeBaseUrl(envUrl.trim())
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
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
  return `${getSiteUrl()}/event/${id}`
}
