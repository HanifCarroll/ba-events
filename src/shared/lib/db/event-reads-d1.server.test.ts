/**
 * The public catalog reads on real Miniflare D1, through the same `client.server.ts` functions the routes call, with
 * the env's `DB` recorded by `useCloudflareBindings` as the SvelteKit hook and the MCP Worker do.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { useCloudflareBindings } from './search-bindings.server.ts'
import {
  getDisplayableEventById,
  getEventArtwork,
  getEventFactsByIds,
  getEventsWithVenues,
  getEventWithVenue,
  getHomeAgendaEvents,
  getVenueById,
} from './client.server.ts'
import { createWorkerHandler } from '../../../mcp-worker/index.ts'
import { homeWindow } from '#features/events/lib/home-feed.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => {
  ({ db, dispose } = await freshD1())
  useCloudflareBindings({ DB: db })
}, 60_000)
afterAll(async () => {
  useCloudflareBindings({})
  await dispose()
})

let counter = 0
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

async function venue(name: string, fields: { neighborhood?: string; address?: string } = {}) {
  const venueId = id()
  await db.prepare('INSERT INTO venues (id, name, neighborhood, address) VALUES (?, ?, ?, ?)')
    .bind(venueId, name, fields.neighborhood ?? null, fields.address ?? null).run()
  return venueId
}

type EventFields = Partial<{ starts_at: string; status: string; venue_id: string | null; image_url: string | null;
  description_summary_es: string | null; location_tba: boolean; location_hidden: boolean; categories: string[];
  price: number | null; is_free: boolean; facets: Record<string, unknown>; scope: 'in' | 'out' | null }>
async function event(name: string, fields: EventFields = {}) {
  const eventId = id()
  await db.prepare(`INSERT INTO events (id, name, starts_at, status, venue_id, image_url, image_width, image_height,
      description_summary_es, location_tba, location_hidden, categories, is_free, price, facets, source, search_document, scope)
    VALUES (?, ?, ?, ?, ?, ?, 800, 600, ?, ?, ?, ?, ?, ?, ?, 'luma', 'secreto', ?)`).bind(
    eventId, name, fields.starts_at ?? inDays(2), fields.status ?? 'scheduled', fields.venue_id ?? null,
    fields.image_url === undefined ? 'https://images.lumacdn.com/uploads/a.png' : fields.image_url,
    fields.description_summary_es === undefined ? 'Una noche de jazz' : fields.description_summary_es,
    fields.location_tba ? 1 : 0, fields.location_hidden ? 1 : 0, JSON.stringify(fields.categories ?? ['music']),
    fields.is_free === false ? 0 : 1, fields.price ?? null, JSON.stringify(fields.facets ?? { genres: ['jazz'] }), fields.scope ?? null).run()
  return eventId
}

beforeEach(async () => {
  await db.batch([db.prepare('DELETE FROM event_source_evidence'), db.prepare('DELETE FROM events'), db.prepare('DELETE FROM venues')])
})

async function linkIntakeEvidence(eventIds: string[]) {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO instagram_sources (username, authority, qualification) VALUES ('fixture', 'venue', 'synthetic')"),
    db.prepare("INSERT OR IGNORE INTO intake_runs (id, local_date, reserved_usd, input) VALUES ('run', '2026-11-01', 1, '{}')"),
    db.prepare(`INSERT OR IGNORE INTO intake_observations (id, run_id, post_id, source_username, post_url, caption, content_hash)
      VALUES ('post', 'run', 'post', 'fixture', 'https://www.instagram.com/p/fixture/', 'Synthetic post', ?)`).bind('0'.repeat(64)),
    db.prepare("INSERT OR IGNORE INTO intake_candidates (id, revision, payload) VALUES ('candidate', 1, '{}')"),
    db.prepare("INSERT OR IGNORE INTO intake_candidate_revisions (candidate_id, revision, payload) VALUES ('candidate', 1, ?)")
      .bind(JSON.stringify({ intent: 'create', price_kind: 'conditional', price_note: 'A la gorra' })),
    ...eventIds.map(eventId => db.prepare("INSERT INTO event_source_evidence VALUES (?, 'candidate', 'post', 1)").bind(eventId)),
  ])
}

describe('public event reads on D1', () => {
  it('home agenda: only scheduled, in-scope events in the local week and at most four later', async () => {
    const window = homeWindow(new Date('2026-11-19T08:00:00.000Z'))
    const bar = await venue('Bar Sintético', { neighborhood: 'Palermo', address: 'Calle Falsa 123' })
    const older = await event('Ayer en Buenos Aires', { starts_at: '2026-11-19T02:59:59.999Z' })
    const first = await event('Empieza hoy a medianoche', { starts_at: window.start, image_url: null })
    const linked = await event('Jazz a la gorra', { venue_id: bar, starts_at: window.tomorrow, is_free: false, facets: { eventType: ['concert'] } })
    const hidden = await event('Lugar privado', { venue_id: bar, location_hidden: true, starts_at: '2026-11-21T20:00:00.000Z' })
    const unconfirmed = await event('Lugar por confirmar', { venue_id: bar, location_tba: true, starts_at: '2026-11-22T20:00:00.000Z' })
    const canceled = await event('Cancelado', { status: 'canceled', starts_at: window.start })
    const out = await event('Fuera de alcance', { starts_at: window.start })
    await event('Sin clasificar', { starts_at: window.start })
    const tail = []
    for (let day = 26; day <= 30; day++) {
      tail.push(await event(`Próximo ${day}`, { starts_at: `2026-11-${day}T03:00:00.000Z` }))
    }
    await linkIntakeEvidence([linked, out])
    await db.batch([
      ...[older, first, linked, hidden, unconfirmed, canceled, ...tail].map(eventId =>
        db.prepare("UPDATE events SET scope = 'in' WHERE id = ?").bind(eventId)),
      db.prepare("UPDATE events SET scope = 'out' WHERE id = ?").bind(out),
    ])

    const cards = await getHomeAgendaEvents(window)
    expect(cards.map(card => card.id)).toEqual([first, linked, hidden, unconfirmed, ...tail.slice(0, 4)])
    expect(cards[0]).toMatchObject({ image_url: null, sourceUrl: null, music: false, payWhatYouCan: false })
    expect(cards[1]).toMatchObject({ sourceUrl: 'https://www.instagram.com/p/fixture/', price: null, is_free: false,
      payWhatYouCan: true, music: true, venue_name: 'Bar Sintético', venue_neighborhood: 'Palermo' })
    expect(cards[1]).not.toHaveProperty('venue_address')
    expect(cards[2]).toMatchObject({ location_hidden: true, venue_name: null, venue_neighborhood: null })
    expect(cards[3]).toMatchObject({ location_tba: true, venue_name: null, venue_neighborhood: null })
  })

  it('event page and chat tools: any status, decoded like events_with_venues, missing ids throw', async () => {
    const bar = await venue('Bar Sintético', { address: 'Calle Falsa 123' })
    const past = await event('Ya pasó', { venue_id: bar, status: 'past' })
    const row = await getEventWithVenue(past)
    expect(row).toMatchObject({ id: past, status: 'past', venue_name: 'Bar Sintético', venue_address: 'Calle Falsa 123',
      categories: ['music'], is_free: true, location_hidden: false, facets: { genres: ['jazz'] } })
    expect(row).not.toHaveProperty('search_document')
    const pending = await event('En revisión', { status: 'pending_review' })
    expect((await getEventWithVenue(pending)).status).toBe('pending_review')
    await expect(getEventWithVenue(id())).rejects.toThrow('not found')
  })

  it('MCP get_event: displayable events only, with the public columns', async () => {
    const live = await event('Público', { scope: 'out' })
    const hidden = await event('Cancelado', { status: 'canceled' })
    const record = await getDisplayableEventById(live)
    expect(record).toMatchObject({ id: live, name: 'Público', status: 'scheduled', is_free: true })
    expect(record).not.toHaveProperty('source')
    expect(record).not.toHaveProperty('facets')
    expect(await getDisplayableEventById(hidden)).toBeNull()
    expect(await getDisplayableEventById(id())).toBeNull()


    // Through the MCP Worker's own entry point, which records the env's DB binding.
    const handler = createWorkerHandler()
    const response = await handler(new Request('https://mcp.test/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', origin: 'https://claude.ai' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_event', arguments: { eventId: live } } }),
    }), { DB: db, MCP_RATE_LIMIT: { limit: async () => ({ success: true }) } } as unknown as Env, {} as Parameters<typeof handler>[2])
    const text = await response.text()
    const body = JSON.parse(text.startsWith('event:') ? text.split('\n').find(line => line.startsWith('data: '))!.slice(6) : text)
    expect(body.result.structuredContent.events.map((item: { id: string }) => item.id)).toEqual([live])
  })

  it('artwork lookup: the image of a scheduled or past event only', async () => {
    const live = await event('Con foto')
    const gone = await event('Cancelado', { status: 'canceled' })
    expect(await getEventArtwork(live)).toEqual({ image_url: 'https://images.lumacdn.com/uploads/a.png' })
    expect(await getEventArtwork(gone)).toBeNull()
  })

  it('event facts: only the fact columns, with the venue withheld when the location is hidden or unconfirmed', async () => {
    const bar = await venue('Bar Sintético')
    const shown = await event('Visible', { venue_id: bar })
    const tba = await event('A confirmar', { venue_id: bar, location_tba: true })
    const facts = await getEventFactsByIds([shown, tba, shown, id()])
    expect(facts.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: shown, name: 'Visible', venue_id: bar, venue_name: 'Bar Sintético', status: 'scheduled' },
      { id: tba, name: 'A confirmar', venue_id: null, venue_name: 'Bar Sintético', status: 'scheduled' },
    ])
    expect(await getEventFactsByIds([])).toEqual([])
  })

  it('venue details: the venue row, and a missing id throws as PostgREST .single() did', async () => {
    const bar = await venue('Bar Sintético', { neighborhood: 'Almagro', address: 'Calle Falsa 123' })
    expect(await getVenueById(bar)).toMatchObject({ id: bar, name: 'Bar Sintético', neighborhood: 'Almagro', address: 'Calle Falsa 123' })
    await expect(getVenueById(id())).rejects.toThrow('not found')
  })

  it('GET /api/events: every status by start, with the admin columns and no search document', async () => {
    const second = await event('Segundo', { starts_at: inDays(3) })
    const first = await event('Primero', { starts_at: inDays(-3), status: 'past' })
    const events = await getEventsWithVenues(10)
    expect(events.map(row => row.id)).toEqual([first, second])
    expect(events[0]).toMatchObject({ status: 'past', is_free: true, categories: ['music'], venue_name: null })
    expect(events[0]).not.toHaveProperty('facets')
    expect(events[0]).not.toHaveProperty('search_document')
    expect(await getEventsWithVenues(1)).toHaveLength(1)
  })

})
