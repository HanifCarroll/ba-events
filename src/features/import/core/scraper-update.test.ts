import { describe, expect, it } from 'vitest'
import { classifyScraperUpdate, getChangedMutableFields, sourceDescriptionsChanged } from './scraper-update.ts'
import type { ExistingEventData } from '../api/duplicate-detection.ts'
import type { EventInsert } from '#shared/lib/types.ts'

const existing: ExistingEventData = {
  id: 'event-1', external_id: 'source-1', name: 'Jazz', description_es: 'Texto', description_en: null,
  starts_at: '2026-08-15T00:00:00.000Z', ends_at: null, is_all_day: false, time_tba: false,
  venue_id: 'venue-1', categories: ['music'], price: 1000, is_free: false, min_age: null,
  image_url: null, image_width: null, image_height: null, link: null, ticket_url: null,
  status: 'scheduled', location_hidden: false, location_tba: false, description_unavailable: false,
  facets: { eventType: [], genres: [], activities: [], vibes: [], audience: [], setting: [] }, embedding_version: 2,
}
const incoming = (overrides: Partial<EventInsert> = {}): EventInsert => ({
  ...existing, embedding_version: undefined, source: 'meetup', external_id: existing.external_id, ...overrides,
})

describe('classifyScraperUpdate', () => {
  it('recognizes unchanged source data', () => {
    expect(classifyScraperUpdate(incoming(), existing, 2)).toBe('unchanged')
  })

  it('recognizes mutable-only changes and retains a stored venue for an empty scrape', () => {
    expect(classifyScraperUpdate(incoming({ image_url: 'https://example.com/image.jpg' }), existing, 2)).toBe('mutable-only')
    expect(classifyScraperUpdate(incoming({ venue_id: null }), existing, 2)).toBe('unchanged')
    expect(classifyScraperUpdate(incoming({ description_unavailable: undefined }), { ...existing, description_unavailable: true }, 2)).toBe('unchanged')
  })

  it('retains enrichment-owned fields before classifying', () => {
    const enriched = incoming({
      description_es: 'Texto del scraper', description_en: 'Scraper text', categories: ['food'],
      facets: { ...existing.facets, genres: ['jazz'] },
    })
    Object.assign(enriched, {
      description_es: existing.description_es, description_en: existing.description_en,
      categories: existing.categories, facets: existing.facets,
    })
    expect(classifyScraperUpdate(enriched, existing, 2)).toBe('unchanged')
  })

  it('returns only changed mutable columns without null clobbers', () => {
    const previous = { ...existing, image_url: 'https://example.com/old.jpg' }
    expect(getChangedMutableFields(incoming({ image_url: null, venue_id: null }), previous)).toEqual({ image_url: null })
    expect(getChangedMutableFields({ name: existing.name, starts_at: existing.starts_at, source: 'meetup' }, existing)).toEqual({})
  })

  it('recognizes search inputs and stale embeddings alongside mutable changes', () => {
    const changed = incoming({ description_es: 'Texto nuevo', image_url: 'https://example.com/image.jpg' })
    expect(classifyScraperUpdate(changed, existing, 2)).toBe('search-input/stale-embedding')
    expect(getChangedMutableFields(changed, existing)).toEqual({ image_url: 'https://example.com/image.jpg' })
    expect(classifyScraperUpdate(incoming({ venue_id: 'venue-2' }), existing, 2)).toBe('search-input/stale-embedding')
    expect(getChangedMutableFields(incoming({ venue_id: 'venue-2' }), existing)).toEqual({ venue_id: 'venue-2' })
    expect(classifyScraperUpdate(incoming(), existing, 3)).toBe('search-input/stale-embedding')
  })

  it('regenerates presentation fields only when a source description changes', () => {
    expect(sourceDescriptionsChanged(incoming(), existing)).toBe(false)
    expect(sourceDescriptionsChanged(incoming({ description_es: 'Texto nuevo' }), existing)).toBe(true)
  })
})
