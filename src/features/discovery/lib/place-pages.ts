import { NEIGHBORHOODS, type Neighborhood, type Venue } from '#shared/lib/types.ts'
import { normalizeText } from '#shared/lib/utils/normalize-text.ts'
import { occurrenceEnd, selectHomeEvents, type HomeAgendaEvent } from '#features/events/lib/home-feed.ts'
import type { AgendaListing } from '#shared/lib/db/event-reads-d1.server.ts'
import { ranked, type DiscoverySnapshot } from './agenda-pages.ts'

export type DiscoveryVenue = Pick<Venue, 'id' | 'name' | 'created_at' | 'address' | 'neighborhood' | 'website' | 'instagram_handle'>
export const placeSlug = (name: string) => normalizeText(name).replaceAll(' ', '-')

export const barriosBySlug: ReadonlyMap<string, Neighborhood> = new Map(NEIGHBORHOODS.map(name => [placeSlug(name), name]))
export const barrioPaths: ReadonlyMap<string, string> = new Map(NEIGHBORHOODS.map(name => [name, `/agenda/barrio/${placeSlug(name)}`]))

/** Collisions are resolved against the venue catalog, not the currently eligible page set. */
export function venuesBySlug(venues: DiscoveryVenue[]): Map<string, DiscoveryVenue> {
  const slugs = new Map<string, DiscoveryVenue>()
  const ordered = [...venues].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id, 'en'))
  for (const venue of ordered) {
    const base = placeSlug(venue.name) || 'lugar'
    // Real IDs are UUIDs. The fallback also keeps imported non-UUID IDs reversible and path-safe.
    const suffix = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(venue.id) ? venue.id :
      'id-' + Array.from(new TextEncoder().encode(venue.id), b => b.toString(16).padStart(2, '0')).join('')
    slugs.set(slugs.has(base) ? `${base}--${suffix}` : base, venue)
  }
  return slugs
}

type ListedLocation = Pick<HomeAgendaEvent, 'location_hidden' | 'location_tba' | 'venue_neighborhood'>

const publicLocation = (event: ListedLocation) => !event.location_hidden && !event.location_tba

export function currentPlaceEvents(snapshot: DiscoverySnapshot) {
  return snapshot.events.filter(event => publicLocation(event) && occurrenceEnd(event) > snapshot.asOf)
}

export function eventsForBarrioIndex(snapshot: DiscoverySnapshot) {
  return currentPlaceEvents(snapshot).filter(event => event.venue_neighborhood && barrioPaths.has(event.venue_neighborhood))
}

export function eventsByVenue(events: AgendaListing[]) {
  const byVenue = new Map<string, AgendaListing[]>()
  for (const event of events) {
    if (!event.venue_id) continue
    const list = byVenue.get(event.venue_id)
    if (list) list.push(event)
    else byVenue.set(event.venue_id, [event])
  }
  return byVenue
}

export function selectBarrio(snapshot: DiscoverySnapshot, barrio: Neighborhood) {
  const filter = (event: AgendaListing) => publicLocation(event) && event.venue_neighborhood === barrio
  return {
    today: selectHomeEvents(snapshot, 'hoy').filter(filter),
    current: selectHomeEvents(snapshot, null).filter(filter),
    next: currentPlaceEvents(snapshot).find(event => event.starts_at >= snapshot.window.end && filter(event)),
  }
}

export function rankBarrios(events: ListedLocation[], omit?: Neighborhood) {
  return ranked(events.flatMap(event => publicLocation(event) && event.venue_neighborhood &&
    event.venue_neighborhood !== omit && barrioPaths.has(event.venue_neighborhood) ? [event.venue_neighborhood] : []))
}
