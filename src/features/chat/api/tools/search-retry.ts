import type { EventSearchIntent, EventSearchMust } from './search-intent.ts'

/** Server-only effective constraints retained across reads within one user turn. */
export interface SearchRetryBoundary {
  must: EventSearchMust
  excludedGenres: string[]
  happeningNow: boolean
  unresolvedVenueName?: string
}

export function searchRetryBoundary(intent: EventSearchIntent, input: { timeFilter?: string; venueName?: string }): SearchRetryBoundary {
  return {
    must: structuredClone(intent.must), excludedGenres: [...(intent.avoid.genres ?? [])],
    happeningNow: input.timeFilter === 'now',
    ...(input.venueName && intent.must.venueIds?.length === 0 ? { unresolvedVenueName: input.venueName } : {}),
  }
}

function setIsNarrower(previous: string[] | undefined, next: string[] | undefined): boolean {
  return previous === undefined || next !== undefined
    && (previous.length === 0 || next.length > 0)
    && next.every(value => previous.includes(value))
}

function windows(must: EventSearchMust) {
  return must.weekdayWindows ?? [{ startsAfter: must.startsAfter, startsBefore: must.startsBefore }]
}

function temporalScopeIsNarrower(previous: EventSearchMust, next: EventSearchMust): boolean {
  const bound = (value: string | undefined, defaultValue: number) => value ? Date.parse(value) : defaultValue
  return windows(next).every(candidate => windows(previous).some(original => {
    const after = bound(candidate.startsAfter, -Infinity)
    const before = bound(candidate.startsBefore, Infinity)
    const originalAfter = bound(original.startsAfter, -Infinity)
    const originalBefore = bound(original.startsBefore, Infinity)
    return ![after, before, originalAfter, originalBefore].some(Number.isNaN)
      && after >= originalAfter && before <= originalBefore
  }))
}

/** Compare effective filters, allowing reordered aliases and narrower ranges. */
export function widenedSearchConstraints(previous: SearchRetryBoundary | undefined, next: SearchRetryBoundary): string[] {
  if (!previous) return []
  const changed: string[] = []
  for (const key of ['neighborhoodIds', 'venueIds', 'categories'] as const) {
    if (!setIsNarrower(previous.must[key], next.must[key])) changed.push(key)
  }
  if (previous.must.isFree === true && next.must.isFree !== true) changed.push('isFree')
  if (previous.must.maxPrice !== undefined && (next.must.maxPrice === undefined || next.must.maxPrice > previous.must.maxPrice)) changed.push('maxPrice')
  if (previous.must.attendeeAge !== undefined && (next.must.attendeeAge === undefined || next.must.attendeeAge > previous.must.attendeeAge)) changed.push('attendeeAge')
  if (!temporalScopeIsNarrower(previous.must, next.must)) changed.push('dates')
  if (!previous.excludedGenres.every(genre => next.excludedGenres.includes(genre))) changed.push('excludedGenres')
  if (previous.happeningNow && !next.happeningNow) changed.push('happeningNow')
  if (previous.unresolvedVenueName && previous.unresolvedVenueName.toLocaleLowerCase() !== next.unresolvedVenueName?.toLocaleLowerCase()) changed.push('venueName')
  return changed
}

export function rejectedSearchRetry(fields: string[]) {
  const error = 'search_constraints_changed'
  return { success: false, formatted: JSON.stringify({ error }), error,
    metadata: { changedConstraints: fields, note: 'Keep the original hard constraints. Ask the user before broadening the search.' } }
}
