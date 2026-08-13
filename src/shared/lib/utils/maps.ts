const MOBILE_USER_AGENT_PATTERN = /Android|iPhone|iPad|iPod/i

export function shouldOpenMapsInSameTab(userAgent: string, hasCoarsePointer: boolean): boolean {
  return hasCoarsePointer || MOBILE_USER_AGENT_PATTERN.test(userAgent)
}

export function openMapsUrl(url: string): void {
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches

  if (shouldOpenMapsInSameTab(navigator.userAgent, hasCoarsePointer)) {
    window.location.assign(url)
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}
