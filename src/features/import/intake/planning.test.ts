import { describe, expect, it } from 'vitest'
import { candidateError, decodeCandidate } from './schema.ts'
import { candidateDoors, candidateStart, canonicalTicket, citesTicketDestination, decideMatch, ticketDestinationChanged,
  separatelyCitedDoors, validateEvidence, type Observation, type Media, type CatalogMatch } from './planning.ts'
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
    expect(validateEvidence(input, [post], [], now)).toContain('Instagram evidence must quote the name for performers: Uncredited Band')
  })
  it('holds a performer quote cut short, but accepts a verbatim name and complete trimmed lines', () => {
    const caption = `${post.caption}\r\n  Nuestra función:  \r\n  Actúa: Luz y Sómbrá  `
    const credit = { observation_id: observationId, fields: ['performers'] as const, excerpt: 'Actúa: Luz', media_id: null }
    const input = { ...candidate(), performers: [{ name: 'Luz' }], evidence: [...candidate().evidence, credit] }
    expect(validateEvidence(input, [{ ...post, caption }], [], now)).toContain('Credit and sale-opening caption evidence must quote complete lines')
    expect(validateEvidence({ ...input, performers: [{ name: 'LUZ Y SOMBRA' }], evidence: [...candidate().evidence,
      { ...credit, excerpt: 'Nuestra función:\nActúa: Luz y Sómbrá' }] }, [{ ...post, caption }], [], now)).toEqual([])
  })
  it('lets the operator interpret an ordinary showtime and quotes a multiline doors label without interpreting it', () => {
    const excerpt = 'Puertas:\n20 hs\nStand up show — sábado 21 hs'
    const posts = [{ ...post, caption: `${post.caption}\n${excerpt}` }]
    const evidence = [{ ...candidate().evidence[0], fields: ['name', 'venue', 'date', 'time', 'doors_time'] as const, excerpt }]
    expect(validateEvidence({ ...candidate(), doors_time: '20:00', evidence }, posts, [], now)).toEqual([])
  })
  it.each([['21 hs', '21:00'], ['21:00', '21:00'], ['21.00 hs', '21:00'], ['20.30', '20:30'], ['9 PM', '21:00'],
    ['9:30 p. m.', '21:30'], ['9:30 pm', '21:30']])('finds door clock %s as %s without requiring a role label', (clock, time) => {
    const excerpt = `Apertura:\n${clock}`
    const evidence = [...candidate().evidence, { observation_id: observationId, fields: ['doors_time'] as const, excerpt, media_id: null }]
    const input = { ...candidate(), time: null, doors_time: time, evidence }
    const posts = [{ ...post, caption: `${post.caption}\n${excerpt}` }]
    expect(validateEvidence(input, posts, [], now)).toEqual([])
    expect(validateEvidence({ ...input, doors_time: '09:30' }, posts, [], now)).toContain('Door time must appear in the cited excerpt')
  })
  it.each(['Puertas:21', 'Apertura de sala: 21', 'Horario:\n21'])('matches a colon-delimited bare hour in %s', excerpt => {
    const quote = { ...candidate().evidence[0], fields: ['doors_time'] as const, excerpt }
    const input = { ...candidate(), time: null, doors_time: '21:00', evidence: [...candidate().evidence, quote] }
    expect(validateEvidence(input, [{ ...post, caption: `${post.caption}\n${excerpt}` }], [], now)).toEqual([])
    expect(validateEvidence(input, [{ ...post, caption: `${post.caption}\n${excerpt}:30` }], [], now))
      .toContain('Door time must appear in the cited excerpt')
  })
  it('matches a caption clock at a bare hour without inspecting the entry line’s wording', () => {
    const caption = 'Ingreso a las 21. A las 21:45 aproximadamente comienza el espectáculo.'
    const quote = { ...candidate().evidence[0], fields: ['doors_time'] as const, excerpt: 'a las 21' }
    const input = { ...candidate(), time: null, doors_time: '21:00', evidence: [...candidate().evidence, quote] }
    const posts = [{ ...post, caption: `${post.caption}\n${caption}` }]
    expect(validateEvidence(input, posts, [], now)).toEqual([])
    expect(validateEvidence({ ...input, doors_time: '18:00' }, posts, [], now)).toContain('Door time must appear in the cited excerpt')
    expect(validateEvidence({ ...input, evidence: [...candidate().evidence, { ...quote, excerpt: 'Boletería a las 21' }] }, posts, [], now))
      .toContain('Caption evidence must be an exact excerpt')
  })
  it('verifies a retained flyer clock for the field the agent cites', () => {
    const caption = `${post.caption}\nLos horarios de los flyers son de ingreso.`
    const posts = [{ ...post, caption }]
    const flyer: Media = { id: eventId, observation_id: observationId, object_key: 'synthetic.jpg', sha256: 'a'.repeat(64), content_type: 'image/jpeg' }
    const flyerClock = { ...candidate().evidence[0], excerpt: '21:00', media_id: flyer.id }
    const base = { ...candidate().evidence[0], fields: ['name', 'date', 'venue'] as const, excerpt: caption }
    expect(validateEvidence({ ...candidate(), time: null, doors_time: '21:00',
      evidence: [base, { ...flyerClock, fields: ['doors_time'] }] }, posts, [flyer], now)).toEqual([])
  })
  it('accepts only the stated start from the flyer’s shared-unit range', () => {
    const flyer: Media = { id: eventId, observation_id: observationId, object_key: 'synthetic.jpg', sha256: 'a'.repeat(64), content_type: 'image/jpeg' }
    const evidence = [
      { ...candidate().evidence[0], fields: ['name', 'date', 'venue'] as const },
      { observation_id: observationId, fields: ['time'] as const, excerpt: 'Todos los días de 20 a 24 h. Ronda de cantantes.', media_id: flyer.id },
    ]
    const input = { ...candidate(), time: '20:00', evidence }
    expect(validateEvidence(input, [post], [flyer], now)).toEqual([])
    expect(validateEvidence({ ...input, time: '21:00' }, [post], [flyer], now)).toEqual(['Start time must appear in the cited excerpt'])
  })
  it.each(['20.11', '20.11 noviembre', '20.11.2026 hs'])('does not read a dotted date as a clock: %s', excerpt => {
    const evidence = [{ ...candidate().evidence[0], fields: ['name', 'date', 'venue', 'doors_time'] as const, excerpt }]
    expect(validateEvidence({ ...candidate(), time: null, doors_time: '20:11', evidence }, [{ ...post, caption: excerpt }], [], now))
      .toContain('Door time must appear in the cited excerpt')
  })
  it.each([['9:30 p. m.', '21:30', '09:30'], ['9:30 p.\u00a0m.', '21:30', '09:30'], ['9:30 a.\u00a0m.', '09:30', '21:30']])(
    'requires the start in its own quote: %s', (clock, correct, wrong) => {
      const excerpt = `Show ${clock}`
      const evidence = [{ ...candidate().evidence[0], excerpt }]
      const posts = [{ ...post, caption: excerpt }]
      expect(validateEvidence({ ...candidate(), time: wrong, evidence }, posts, [], now)).toContain('Start time must appear in the cited excerpt')
      expect(validateEvidence({ ...candidate(), time: correct, evidence }, posts, [], now)).toEqual([])
    })
  describe.each([['time', 'Show', 'Start'], ['doors_time', 'Puerta', 'Door']] as const)('%s caption evidence', (field, label, reason) => {
    it.each([['U+0020', ' '], ['U+00A0', '\u00a0'], ['U+202F', '\u202f']])('does not let an excerpt drop the caption clock meridiem (%s)', (_, space) => {
      const partial = `${label} 9:30`, full = `${partial} p.${space}m.`
      const posts = [{ ...post, caption: `${post.caption}\r\n  ${full}  ` }]
      const evidence = (excerpt: string) => [{ ...candidate().evidence[0], fields: ['name', 'date', 'venue', field] as const, excerpt }]
      const input = { ...candidate(), time: null, evidence: evidence(partial) }
      for (const time of ['09:30', '21:30']) {
        expect(validateEvidence({ ...input, [field]: time }, posts, [], now)).toContain(`${reason} time must appear in the cited excerpt`)
      }
      expect(validateEvidence({ ...input, [field]: '21:30', evidence: evidence(full) }, posts, [], now)).toEqual([])
    })
  })
  it('requires two separate clock tokens when the reported doors and start times are equal', () => {
    const evidence = (excerpt: string) => [{ ...candidate().evidence[0], fields: ['name', 'date', 'venue', 'time', 'doors_time'] as const, excerpt }]
    const input = { ...candidate(), doors_time: '21:00' }
    const single = 'Puertas:\n21 hs'
    const posts = [{ ...post, caption: single }]
    expect(validateEvidence({ ...input, evidence: [...evidence(single), ...evidence(single)] }, posts, [], now))
      .toContain('Equal doors and start times need two separate clocks in the doors excerpt')
    const both = `${single}\nShow: 9 PM`
    expect(validateEvidence({ ...input, evidence: evidence(both) }, [{ ...post, caption: both }], [], now)).toEqual([])
  })
  it('requires two separate clocks in an official-page quote when doors and start are equal', () => {
    const page = { kind: 'official_page' as const, url: 'https://teatro.example.org/obra', fields: ['time', 'doors_time'] as const }
    const input = { ...candidate(), doors_time: '21:00' }
    const reasons = (excerpt: string) => validateEvidence({ ...input, evidence: [...input.evidence, { ...page, excerpt }] }, [post], [], now)
    expect(reasons('Apertura de sala 21 hs')).toContain('Equal doors and start times need two separate clocks in the doors excerpt')
    expect(reasons('21:00 - 21:00')).toContain('Equal doors and start times need two separate clocks in the doors excerpt')
    expect(reasons('Apertura de sala 21 hs | Música a las 21')).toEqual([])
    expect(separatelyCitedDoors([{ ...page, fields: ['time'], excerpt: 'Empieza el lun. 23 de nov 2026 a las 21:00 - 21:00' }],
      '21:00', [], true)).toBe(false)
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
  it('requires a full sale-opening line and matches its local date and clock even without a sale keyword', () => {
    const excerpt = 'Reserva anticipada: 15.11.2026 — 3:00 p. m.'
    const quote = { observation_id: observationId, fields: ['offers_valid_from'] as const, excerpt, media_id: null }
    const postWithSale = { ...post, caption: `${post.caption}\n${excerpt}` }
    const input = { ...candidate(), offers_valid_from: '2026-11-15T18:00:00.000Z', evidence: [...candidate().evidence, quote] }
    expect(validateEvidence(input, [postWithSale], [], now)).toEqual([])
    expect(validateEvidence({ ...input, evidence: [...candidate().evidence, { ...quote, excerpt: '15.11.2026 — 3:00 p. m.' }] }, [postWithSale], [], now))
      .toContain('Credit and sale-opening caption evidence must quote complete lines')
  })
  it.each([['organizer', 'Pássline'], ['organizer', 'Alternativa Teatral'], ['performers', 'Tu Entrada'],
    ['performers', 'passline.com'], ['performers', 'Synthetic Venue']] as const)(
    'rejects an exact ticket-seller or venue name for %s: %s', (role, name) => {
      const excerpt = `Créditos: ${name}`
      const evidence = [...candidate().evidence, { observation_id: observationId, fields: [role], excerpt, media_id: null }]
      const input = { ...candidate(), evidence, ...(role === 'organizer' ? { organizer: { name } } : { performers: [{ name }] }) }
      expect(validateEvidence(input, [{ ...post, caption: `${post.caption}\n${excerpt}` }], [], now))
        .toContain(`A ticket seller or the venue itself cannot be credited as ${role}: ${name}`)
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
  it('keeps balanced parentheses in URLs and strips only extra wrapping parentheses', () => {
    const url = 'https://tickets.example/show_(BA)', prefix = 'https://tickets.example/show_(BA'
    const caption = `Reserva: (${url}).`
    expect(citesTicketDestination(url, url, caption)).toBe(true)
    expect(citesTicketDestination(prefix, prefix, caption)).toBe(false)
    expect(citesTicketDestination(prefix, url, caption)).toBe(false)
  })
  it('finds complete scheme-less links without reading email addresses or unlisted bare domains as links', () => {
    expect(citesTicketDestination('www.tickets.example/show', 'https://tickets.example/show')).toBe(true)
    expect(citesTicketDestination('passline.com/evento/x', 'https://www.passline.com/evento/x')).toBe(true)
    expect(citesTicketDestination('eventbrite.com.ar/evento/x', 'https://eventbrite.com.ar/evento/x')).toBe(true)
    expect(citesTicketDestination('passline.com/evento/x', 'https://passline.com/evento/x', 'hi@passline.com/evento/x')).toBe(false)
    expect(citesTicketDestination('tickets.example/show', 'https://tickets.example/show')).toBe(false)
  })
  it('uses the same destination for a ticket rewrite and a complete quoted URL token', () => {
    const url = 'https://tickets.example/replacement?session=late'
    const equivalent = 'http://www.tickets.example/replacement/?session=late&utm_source=ig'
    expect(canonicalTicket(equivalent)).toBe(url)
    expect(ticketDestinationChanged(url, equivalent)).toBe(false)
    expect(ticketDestinationChanged(url, 'https://www.tickets.example/replacement?session=early')).toBe(true)
    expect(citesTicketDestination(equivalent, url, `Reserva: (${equivalent}).`)).toBe(true)
    expect(citesTicketDestination(url, url, `${url}-extra`)).toBe(false)
    expect(citesTicketDestination('https://tickets.example/replacement', 'https://tickets.example/replacement',
      'Reserva: https://tickets.example/replacement-extra')).toBe(false)
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
