import { describe, expect, it } from 'vitest'
import { decodeCandidate } from './schema.ts'
import { candidateStart, canonicalTicket, decideMatch, validateEvidence, type Observation, type Media, type CatalogMatch } from './planning.ts'
import { allowedInstagramMedia, fetchInstagramImage, mediaUrls } from './collection.ts'

const id = '10000000-0000-4000-8000-000000000001'
const eventId = '20000000-0000-4000-8000-000000000001'
const observationId = '30000000-0000-4000-8000-000000000001'
const candidate = () => decodeCandidate({ id, expected_revision: 0, intent: 'create', target_event_id: null,
  name: 'Synthetic Jazz', date: '2026-11-20', time: '21:00', venue_name: 'Synthetic Venue', venue_id: id,
  description_es: null, description_en: null, categories: ['music'], status: 'scheduled', price_kind: 'unknown',
  price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, issues: [], notes: '',
  evidence: [{ observation_id: observationId, fields: ['name','date','time','venue'], excerpt: 'Synthetic Jazz 20/11 21:00 Synthetic Venue', media_id: null }],
})
const post: Observation = { id: observationId, post_id: 'synthetic-post', source_username: 'synthetic_venue', caption: 'Synthetic Jazz 20/11 21:00 Synthetic Venue', observed_at: '2026-10-25T12:00:00Z', post_url: 'https://www.instagram.com/p/synthetic/', authority: 'venue' }
const existing: CatalogMatch = { id: eventId, name: 'Synthetic Jazz', starts_at: '2026-11-21T00:00:00Z', venue_id: id, ticket_url: null, link: null, updated_at: '2026-10-25T12:00:00Z', status: 'scheduled' }
const now = new Date('2026-10-25T12:00:00Z')

describe('Instagram candidate publication rules', () => {
  it('rejects invalid calendar dates and retains the BA date when time is unknown', () => {
    expect(() => candidateStart({ ...candidate(), date: '2026-11-31' })).toThrow('Invalid calendar date')
    expect(candidateStart({ ...candidate(), time: null })).toBe('2026-11-20T03:00:00.000Z')
  })
  it('does not reinterpret conditional admission as free', () => {
    expect(validateEvidence({ ...candidate(), price_kind: 'conditional', price_ars: 0 }, [post], [], now)).toContain('Only a fixed price may set price_ars')
    expect(validateEvidence({ ...candidate(), price_kind: 'conditional' }, [post], [], now)).toContain('Conditional admission needs its conditions')
  })
  it('requires retained matching evidence and a verified venue', () => {
    expect(validateEvidence(candidate(), [post], [], now)).toEqual([])
    expect(validateEvidence(candidate(), [{ ...post, caption: 'Different caption' }], [], now)).toContain('Caption evidence must be an exact excerpt')
    expect(validateEvidence({ ...candidate(), venue_id: null }, [post], [], now)).toContain('Venue must be resolved before publishing')
    expect(validateEvidence({ ...candidate(), artwork_media_id: eventId }, [post], [], now)).toContain('Artwork must come from the retained evidence')
  })
  it('does not accept another post\'s flyer as evidence', () => {
    const value = { ...candidate(), evidence: [{ ...candidate().evidence[0], media_id: eventId }] }
    const media: Media = { id: eventId, observation_id: id, object_key: 'synthetic.jpg', sha256: 'a'.repeat(64), content_type: 'image/jpeg' }
    expect(validateEvidence(value, [post], [media], now)).toContain('Flyer evidence is not attached to this observation')
  })
  it('links repeated promotions to the same occurrence without automatically changing its facts', () => {
    expect(decideMatch(candidate(), [existing], [], []).action).toBe('link')
    expect(decideMatch(candidate(), [existing], [], []).target?.id).toBe(eventId)
    expect(decideMatch(candidate(), [{ ...existing, starts_at: '2026-11-22T00:00:00Z' }], [], []).action).toBe('create')
  })
  it('preserves event identity across a reschedule', () => {
    const rescheduled = { ...candidate(), intent: 'update' as const, target_event_id: eventId, date: '2026-12-01' }
    expect(decideMatch(rescheduled, [existing], [eventId], [])).toEqual({ action: 'update', target: existing, reasons: [] })
  })
  it('separates explicitly evidenced showtimes even when they share a ticket page', () => {
    const second = { ...candidate(), time: '23:00', ticket_url: 'https://tickets.example/show', distinct_occurrence: true,
      notes: 'The retained flyer explicitly advertises two separate performances.' }
    expect(decideMatch(second, [{ ...existing, ticket_url: second.ticket_url }], [], []).action).toBe('create')
    expect(decideMatch({ ...second, distinct_occurrence: false }, [existing], [], []).action).toBe('held')
  })
  it('holds ambiguous matches, source conflicts and unresolved issues', () => {
    expect(decideMatch(candidate(), [existing, { ...existing, id }], [], []).action).toBe('held')
    expect(decideMatch(candidate(), [{ ...existing, name: 'Synthetic Jazz with friends', starts_at: '2026-11-21T01:00:00Z' }], [], []).action).toBe('held')
    expect(decideMatch(candidate(), [existing], [id, eventId], []).action).toBe('held')
    expect(decideMatch(candidate(), [], [], ['Rain date is conditional']).action).toBe('held')
  })
  it('removes only tracking parameters from ticket identities', () => {
    expect(canonicalTicket('https://tickets.example/event?session=late&utm_source=ig')).toBe('https://tickets.example/event?session=late')
    expect(canonicalTicket('javascript:alert(1)')).toBeNull()
  })
})

describe('retained Instagram media boundary', () => {
  it('includes carousel slides instead of just the cover', () => {
    expect(mediaUrls({ displayUrl: 'cover', childPosts: [{ displayUrl: 'first' }, { displayUrl: 'second' }] })).toEqual(['first', 'second'])
  })
  it.each(['http://scontent.cdninstagram.com/a', 'https://cdninstagram.com.evil.test/a', 'https://127.0.0.1/a', 'https://user:pass@scontent.cdninstagram.com/a'])('rejects unsafe destinations: %s', url => {
    expect(allowedInstagramMedia(url)).toBe(false)
  })
  it('bounds downloaded bytes and checks the image itself', async () => {
    const url = 'https://scontent.cdninstagram.com/synthetic.jpg'
    const html = (async () => new Response('<html>not an image</html>')) as typeof fetch
    await expect(fetchInstagramImage(url, html)).rejects.toThrow('Unsupported image bytes')
    const oversized = (async () => new Response('image', { headers: { 'content-length': '10485761' } })) as typeof fetch
    await expect(fetchInstagramImage(url, oversized)).rejects.toThrow('exceeds limit')
    const jpeg = (async (_input: unknown, init: RequestInit | undefined) => {
      expect(init?.redirect).toBe('error')
      return new Response(new Uint8Array([255,216,255,0]))
    }) as typeof fetch
    expect((await fetchInstagramImage(url, jpeg)).object_key).toMatch(/^[a-f0-9]{64}\.jpg$/)
  })
})
