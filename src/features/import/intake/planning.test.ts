import { describe, expect, it } from 'vitest'
import { candidateError, decodeCandidate } from './schema.ts'
import { candidateDoors, candidateStart, canonicalTicket, decideMatch, validateEvidence, type Observation, type Media, type CatalogMatch } from './planning.ts'
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
  it.each([
    ['expected_revision', 1.5, 'Expected an integer'],
    ['price_ars', -1, 'Expected a value greater than or equal to 0'],
  ])('preserves the operator message for an invalid %s', (field, value, message) => {
    const input = { ...candidate(), [field]: value }
    expect.assertions(1)
    try {
      decodeCandidate(input)
    } catch (error) {
      expect(candidateError(error, input)).toBe(`Invalid candidate: ${field}: ${message}`)
    }
  })
  it('rejects invalid calendar dates and retains the BA date when time is unknown', () => {
    expect(() => candidateStart({ ...candidate(), date: '2026-11-31' })).toThrow('Invalid calendar date')
    expect(candidateStart({ ...candidate(), time: null })).toBe('2026-11-20T03:00:00.000Z')
  })
  it('keeps an after-midnight door time distinct from an unknown start', () => {
    const input = { ...candidate(), time: null, doors_time: '00:30', doors_date: '2026-11-21' }
    expect(candidateStart(input)).toBe('2026-11-20T03:00:00.000Z')
    expect(candidateDoors(input)).toBe('2026-11-21T03:30:00.000Z')
    expect(validateEvidence(input, [post], [], now)).toContain('Missing evidence for doors_time')
    expect(validateEvidence({ ...input, doors_date: '2026-11-23' }, [post], [], now)).toContain('Door time must be on the event date or an adjacent day')
    expect(candidateDoors({ ...input, date: '2026-11-21', time: '01:00', doors_date: '2026-11-20', doors_time: '23:30' }))
      .toBe('2026-11-21T02:30:00.000Z')
  })
  it('rejects credits that are not present in their cited caption', () => {
    const input = { ...candidate(), performers: [{ name: 'Uncredited Band' }],
      evidence: [{ ...candidate().evidence[0], fields: [...candidate().evidence[0].fields, 'performers' as const] }] }
    expect(validateEvidence(input, [post], [], now)).toContain('Instagram evidence must explicitly credit performers: Uncredited Band')
  })
  it('does not take a posting account as the credited organizer without a stated credit', () => {
    const input = { ...candidate(), organizer: { name: 'Synthetic Producer' },
      evidence: [{ ...candidate().evidence[0], fields: [...candidate().evidence[0].fields, 'organizer' as const] }] }
    expect(validateEvidence(input, [{ ...post, authority: 'organizer', source_username: 'synthetic_producer' }], [], now))
      .toContain('Instagram evidence must explicitly credit organizer: Synthetic Producer')
  })
  it('binds clocks to the show and doors labels, including a trimmed quote from a caption', () => {
    const excerpt = 'Synthetic Jazz — Puertas 21 hs - Show 22 hs'
    const evidence = [{ observation_id: observationId, fields: ['name', 'venue', 'date', 'time', 'doors_time'] as const, excerpt, media_id: null }]
    const input = { ...candidate(), time: '22:00', doors_time: '21:00', evidence }
    const posts = [{ ...post, caption: excerpt }]
    expect(validateEvidence(input, posts, [], now)).toEqual([])
    expect(validateEvidence({ ...input, time: '21:00' }, posts, [], now)).toContain('Start time must match the labeled show clock, not doors')
    expect(validateEvidence({ ...input, doors_time: '22:00' }, posts, [], now)).toContain('Door time must match the labeled doors clock')
    const trimmed = [{ ...evidence[0], excerpt: '21 hs', fields: ['time'] as const }]
    expect(validateEvidence({ ...input, time: '21:00', evidence: trimmed }, posts, [], now)).toContain('Start time must match the labeled show clock, not doors')
  })
  it('checks trimmed clocks against the full caption lines even when a quote spans lines', () => {
    const caption = 'Synthetic Jazz 20/11\nPuertas 21 hs\nShow 22 hs'
    const excerpt = { observation_id: observationId, media_id: null }
    const input = { ...candidate(), time: '22:00', doors_time: '21:00', evidence: [
      { ...excerpt, fields: ['name', 'date', 'venue'] as const, excerpt: 'Synthetic Jazz 20/11' },
      { ...excerpt, fields: ['time'] as const, excerpt: '22 hs' },
      { ...excerpt, fields: ['doors_time'] as const, excerpt: '21 hs' },
    ] }
    const posts = [{ ...post, caption }]
    expect(validateEvidence({ ...input, time: '21:00' }, posts, [], now)).toContain('Start time must match the labeled show clock, not doors')
    expect(validateEvidence(input, posts, [], now)).toEqual([])
    expect(validateEvidence({ ...input, evidence: input.evidence.map(item => item.excerpt === '22 hs' ?
      { ...item, excerpt: '21 hs\nShow 22 hs' } : item) }, posts, [], now)).toEqual([])
  })
  it.each(['Show', 'Comienzo', 'Empieza', 'Arranca'])('recognizes %s and reads the complete 12-hour clock', label => {
    const caption = `Synthetic Jazz 20/11\nPuertas 20 hs - ${label} 9:30 PM`
    const evidence = [{ ...candidate().evidence[0], excerpt: '9:30 PM' }]
    expect(validateEvidence({ ...candidate(), time: '21:30', evidence }, [{ ...post, caption }], [], now)).toEqual([])
    expect(validateEvidence({ ...candidate(), time: '09:30', evidence: [{ ...evidence[0], excerpt: '9:30' }] }, [{ ...post, caption }], [], now))
      .toContain('Start time must match the labeled show clock, not doors')
  })
  it('requires an explicit doors date before 06:00 even when only doors are known', () => {
    const excerpt = 'Synthetic Jazz, Puerta 00:30'
    const evidence = [{ observation_id: observationId, fields: ['name', 'venue', 'date', 'doors_time'] as const, excerpt, media_id: null }]
    const input = { ...candidate(), time: null, doors_time: '00:30', evidence }
    expect(validateEvidence(input, [{ ...post, caption: excerpt }], [], now)).toContain('State doors_date for an after-midnight door time')
    expect(validateEvidence({ ...input, doors_date: '2026-11-21' }, [{ ...post, caption: excerpt }], [], now)).toEqual([])
  })
  it.each(['Entradas a la venta desde el lunes', 'Entradas a la venta desde el 15/11', 'Entradas a la venta desde el 16/11 a las 15:00', 'Entradas a la venta desde el 15/11 a las 16:00'])('rejects an unstated or mismatched sale opening: %s', excerpt => {
    const evidence = [...candidate().evidence, { observation_id: observationId, fields: ['offers_valid_from'] as const, excerpt, media_id: null }]
    const input = { ...candidate(), offers_valid_from: '2026-11-15T18:00:00.000Z', evidence }
    expect(validateEvidence(input, [{ ...post, caption: `${post.caption}\n${excerpt}` }], [], now)).toContain('Ticket-sale opening needs the stated calendar date and time')
  })
  it.each([
    ['organizer', 'Passline', 'Presenta: Passline'],
    ['organizer', 'Colectivo Nube', 'Entradas: Colectivo Nube'],
    ['organizer', 'Colectivo Nube', 'Con el apoyo de Colectivo Nube'],
    ['performers', 'Trío Sol', 'After-party\nDJ: Uno\nDJ: Trío Sol'],
  ] as const)('rejects unsupported %s roles even when the name is quoted', (role, name, caption) => {
    const excerpt = caption.split('\n').at(-1)!
    const evidence = [...candidate().evidence, { observation_id: observationId, fields: [role], excerpt, media_id: null }]
    const input = { ...candidate(), evidence, ...(role === 'organizer' ? { organizer: { name } } : { performers: [{ name }] }) }
    expect(validateEvidence(input, [{ ...post, caption: `${post.caption}\n${caption}` }], [], now)).toContain(`Instagram evidence must explicitly credit ${role}: ${name}`)
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
  it('counts official-page fields without changing the caption rule, and still needs a post', () => {
    const page = { kind: 'official_page' as const, url: 'https://teatro.example.org/obra', fields: ['date' as const, 'time' as const], excerpt: 'Lunes 23 noviembre 21:00' }
    const value = { ...candidate(), evidence: [{ ...candidate().evidence[0], fields: ['name' as const, 'venue' as const], excerpt: 'Synthetic Jazz' }, page] }
    expect(validateEvidence(value, [post], [], now)).toEqual([])
    expect(validateEvidence({ ...value, evidence: [{ ...value.evidence[0], excerpt: 'Synthetic  Jazz' }, page] }, [post], [], now)).toContain('Caption evidence must be an exact excerpt')
    expect(validateEvidence({ ...value, evidence: [page] }, [], [], now)).toContain('At least one Instagram post must support the candidate')
    expect(() => decodeCandidate({ ...value, expected_revision: 0, evidence: [{ ...page, observation_id: observationId }] })).toThrow()
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
    const html = (async () => new Response('<html>not an image</html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch
    await expect(fetchInstagramImage(url, html)).rejects.toThrow('not an image (text/html)')
    const oversized = (async () => new Response('image', { headers: { 'content-length': '10485761' } })) as typeof fetch
    await expect(fetchInstagramImage(url, oversized)).rejects.toThrow('over 10 MB')
    const jpeg = (async (_input: unknown, init: RequestInit | undefined) => {
      expect(init?.redirect).toBe('manual')
      return new Response(new Uint8Array([255,216,255,0]))
    }) as typeof fetch
    expect((await fetchInstagramImage(url, jpeg)).object_key).toMatch(/^[a-f0-9]{64}\.jpg$/)
  })
  it('names why a download failed, and never follows a redirect', async () => {
    const url = 'https://scontent.cdninstagram.com/synthetic.jpg'
    const answer = (response: Response) => (async () => response) as unknown as typeof fetch
    await expect(fetchInstagramImage(url, answer(new Response('no', { status: 403 })))).rejects.toThrow('answered 403')
    await expect(fetchInstagramImage(url, answer(new Response(null, { status: 302, headers: { location: 'https://evil.test/x' } })))).rejects.toThrow('redirected')
    const timeout = (async () => { throw new DOMException('The operation timed out.', 'TimeoutError') }) as unknown as typeof fetch
    await expect(fetchInstagramImage(url, timeout)).rejects.toThrow('timed out after 15 s')
    const refused = (async () => { throw Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' }) }) as unknown as typeof fetch
    await expect(fetchInstagramImage(url, refused)).rejects.toThrow('Unable to connect (ConnectionRefused)')
  })
})
