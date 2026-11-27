import { describe, expect, it } from 'vitest'
import { addDays, baInstant } from './format.ts'
import { FORMATS, runWindow } from './formats.ts'
import { qualifies } from './select.ts'
import { accountIsVenue, selectEvents, stripVenueSuffix, toPostEvent, type CatalogEvent } from './select.ts'

let seq = 0
const event = (overrides: Partial<CatalogEvent> = {}): CatalogEvent => ({
  id: `event-${++seq}`,
  name: 'Concierto',
  startsAt: '2026-11-21T00:00:00.000Z', // Friday 20, 21:00
  endsAt: null,
  price: null,
  isFree: false,
  payWhatYouWant: false,
  status: 'scheduled',
  timeTba: false,
  isAllDay: false,
  categories: ['music'],
  summary: 'Una noche de música.',
  imageUrl: null,
  venue: `Sala ${seq}`,
  barrio: 'Palermo',
  venueHandle: null,
  sourceAccount: 'cuenta',
  intakeTimeUnknown: false,
  ...overrides,
})

const finde = runWindow('finde', '2026-11-20')

describe('qualifying events', () => {
  it('drops cancelled, time-TBA, all-day, venueless, and barrio-less events', () => {
    const good = event()
    const picked = selectEvents([
      good,
      event({ status: 'canceled' }),
      event({ timeTba: true }),
      event({ isAllDay: true }),
      event({ venue: null }),
      event({ barrio: null }),
      event({ startsAt: '2026-11-23T03:00:00.000Z' }), // Monday 00:00, outside the weekend
    ], 'finde', finde)
    expect(picked.map(p => p.id)).toEqual([good.id])
  })

  it('drops placeholder start times: 23:59, and 00:00 when the intake left the time empty', () => {
    const real = event({ startsAt: '2026-11-21T03:00:00.000Z' }) // Saturday 00:00, a real midnight start
    const noTime = event({ startsAt: '2026-11-22T03:00:00.000Z', intakeTimeUnknown: true }) // Sunday 00:00, time unknown
    const lastMinute = event({ startsAt: '2026-11-22T02:59:00.000Z' }) // Saturday 23:59
    const withSeconds = event({ startsAt: '2026-11-22T02:59:35.000Z' }) // Saturday 23:59:35
    expect(selectEvents([real, noTime, lastMinute, withSeconds], 'finde', finde).map(p => p.id)).toEqual([real.id])
  })

  it('keeps Hoy to events starting at 18:00 or later that day', () => {
    const hoy = runWindow('hoy', '2026-11-18')
    const early = event({ startsAt: '2026-11-18T20:59:00.000Z' }) // 17:59
    const six = event({ startsAt: '2026-11-18T21:00:00.000Z' }) // 18:00
    const late = event({ startsAt: '2026-11-19T02:30:00.000Z' }) // 23:30
    const tomorrow = event({ startsAt: '2026-11-19T03:00:00.000Z' }) // 00:00 next day
    expect(selectEvents([early, six, late, tomorrow], 'hoy', hoy).map(p => p.id)).toEqual([six.id, late.id])
  })

  it('drops events that are over by the publish slot', () => {
    const gratis = runWindow('gratis', '2026-11-23') // publishes Monday 12:00
    const morning = event({ startsAt: '2026-11-23T13:00:00.000Z', endsAt: '2026-11-23T14:00:00.000Z', isFree: true, price: 0 }) // Monday 10:00 to 11:00
    const allDay = event({ startsAt: '2026-11-23T13:00:00.000Z', endsAt: '2026-11-23T20:00:00.000Z', isFree: true, price: 0 }) // until 17:00
    const noEnd = event({ startsAt: '2026-11-23T14:00:00.000Z', isFree: true, price: 0 }) // Monday 11:00, no end
    expect(selectEvents([morning, allDay, noEnd], 'gratis', gratis).map(p => p.id)).toEqual([allDay.id])
  })

  it('takes only free events for Gratis', () => {
    const gratis = runWindow('gratis', '2026-11-23')
    const free = event({ startsAt: '2026-11-24T23:00:00.000Z', isFree: true, price: 0 })
    const paid = event({ startsAt: '2026-11-24T23:00:00.000Z', price: 5000 })
    expect(selectEvents([free, paid], 'gratis', gratis).map(p => p.id)).toEqual([free.id])
  })
})

describe('picking the mix', () => {
  it.each(['finde', 'reel', 'gratis'] as const)('covers qualifying local days for %s even when the first day has stronger picks', format => {
    const window = runWindow(format, format === 'gratis' ? '2026-11-23' : '2026-11-20')
    const { max, days } = FORMATS[format]
    const firstDay = Array.from({ length: max + 2 }, (_, i) => event({
      startsAt: baInstant(window.from, 20, i).toISOString(),
      isFree: true,
      imageUrl: 'https://imagenes.passline.com/eventos/a.jpg',
      barrio: `Barrio ${i}`,
      categories: [`c${i}`],
    }))
    const later = Array.from({ length: days - 1 }, (_, i) => event({
      startsAt: baInstant(addDays(window.from, i + 1), 23).toISOString(), // UTC date is the next day.
      isFree: true,
      summary: null,
    }))
    const pool = [...firstDay, ...later]
    const picked = selectEvents(pool, format, window)
    expect(picked.map(p => p.id)).toEqual([...firstDay.slice(0, max - later.length), ...later].map(e => e.id))
    expect(selectEvents(pool.toReversed(), format, window)).toEqual(picked)
    expect(selectEvents(firstDay, format, window).map(p => p.id)).toEqual(firstDay.slice(0, max).map(e => e.id))
  })

  it('covers all feasible days without losing the free pick or repeating a venue', () => {
    const freeFriday = event({ isFree: true, venue: 'Sala Lúcida', imageUrl: 'https://imagenes.passline.com/eventos/a.jpg' })
    const saturday = event({ venue: 'Sala Lucida —', startsAt: baInstant('2026-11-21', 21).toISOString() })
    const friday = event()
    const freeSunday = event({ isFree: true, startsAt: baInstant('2026-11-22', 21).toISOString() })
    expect(selectEvents([freeFriday, saturday, friday, freeSunday], 'finde', finde).map(p => p.id))
      .toEqual([friday.id, saturday.id, freeSunday.id])
  })

  it('allows one event per venue, matching names loosely', () => {
    const a = event({ venue: 'Sala Lúcida' })
    const b = event({ venue: 'Sala Lucida —', startsAt: '2026-11-21T22:00:00.000Z' })
    expect(selectEvents([a, b], 'finde', finde)).toHaveLength(1)
  })

  it('includes a free event when one qualifies, even if it is otherwise the weakest', () => {
    const paid = Array.from({ length: 8 }, (_, i) => event({ barrio: `Barrio ${i}`, categories: [`c${i}`] }))
    const free = event({ isFree: true, summary: null, barrio: 'Palermo', categories: ['music'], startsAt: '2026-11-22T23:00:00.000Z' })
    const picked = selectEvents([...paid, free], 'finde', finde)
    expect(picked).toHaveLength(6)
    expect(picked.some(p => p.id === free.id)).toBe(true)
  })

  it('spreads barrios and prefers events with a description line', () => {
    const palermo = Array.from({ length: 6 }, () => event({ barrio: 'Palermo' }))
    const others = ['Boedo', 'Almagro', 'Flores'].map(barrio => event({ barrio }))
    const noText = event({ barrio: 'Once', summary: null })
    const picked = selectEvents([...palermo, ...others, noText], 'finde', finde)
    expect(new Set(picked.map(p => p.barrio))).toEqual(new Set(['Palermo', 'Boedo', 'Almagro', 'Flores', 'Once']))
    expect(picked).toHaveLength(6)
  })

  it('prefers events with artwork, without dropping a qualifying event that has none', () => {
    const art = 'https://imagenes.passline.com/eventos/a.jpg'
    const plain = Array.from({ length: 5 }, (_, i) => event({ barrio: `Barrio ${i}`, categories: [`c${i}`] }))
    const flyers = Array.from({ length: 4 }, () => event({ barrio: 'Palermo', summary: null, imageUrl: art, startsAt: '2026-11-22T23:00:00.000Z' }))
    const picked = selectEvents([...plain, ...flyers], 'finde', finde)
    expect(picked).toHaveLength(6)
    expect(picked.filter(p => p.artworkRef).map(p => p.id)).toEqual(flyers.map(e => e.id))
    expect(picked.filter(p => !p.artworkRef)).toHaveLength(2)
    // Not enough flyers to fill the post: the rest still qualify.
    expect(selectEvents(plain, 'finde', finde)).toHaveLength(5)
    expect(toPostEvent(event({ imageUrl: '  ' })).artworkRef).toBeNull()
  })

  it('still shows one event per venue when only the later one has artwork', () => {
    const plain = event({ venue: 'Sala Lúcida' })
    const flyer = event({ venue: 'Sala Lucida —', startsAt: '2026-11-21T22:00:00.000Z', imageUrl: 'https://imagenes.passline.com/eventos/a.jpg' })
    expect(selectEvents([plain, flyer], 'finde', finde).map(p => p.id)).toEqual([flyer.id])
  })

  it('picks the Reel like the carousel: flyer-less events and the only free event are never dropped', () => {
    const reel = runWindow('reel', '2026-11-20')
    const at = (hour: number) => ({ startsAt: `2026-11-22T${hour}:00:00.000Z` })
    const flyers = Array.from({ length: 4 }, (_, i) => event({ ...at(20 + (i % 3)), price: 5000, imageUrl: `https://imagenes.passline.com/eventos/${i}.jpg` }))
    const plain = event({ ...at(21), price: 5000 })
    const free = event({ ...at(22), isFree: true, price: 0 })
    const picked = selectEvents([...flyers, plain, free], 'reel', reel)
    expect(picked).toHaveLength(6)
    expect(picked.map(p => p.id)).toContain(free.id)
    expect(picked.filter(p => p.artworkRef)).toHaveLength(4)
    expect(new Set(picked.map(p => p.id))).toEqual(new Set(selectEvents([...flyers, plain, free], 'finde', finde).map(p => p.id)))
    // With more candidates than places, the ones with flyers still win the remaining places.
    const more = Array.from({ length: 4 }, (_, i) => event({ ...at(20), barrio: `Barrio ${i}`, categories: [`c${i}`] }))
    const crowded = selectEvents([...flyers, plain, free, ...more], 'reel', reel)
    expect(crowded.map(p => p.id)).toContain(free.id)
    expect(crowded.filter(p => p.artworkRef)).toHaveLength(4)
  })

  it('counts only an https address as artwork', () => {
    const insecure = event({ imageUrl: 'http://imagenes.passline.com/eventos/a.jpg', barrio: 'Boedo', categories: ['x'] })
    const relative = event({ imageUrl: '//imagenes.passline.com/eventos/a.jpg', barrio: 'Flores', categories: ['y'] })
    const secure = Array.from({ length: 6 }, () => event({ imageUrl: ' https://imagenes.passline.com/eventos/b.jpg ', summary: null }))
    const picked = selectEvents([insecure, relative, ...secure], 'finde', finde)
    expect(picked.map(p => p.id).sort()).toEqual(secure.map(e => e.id).sort())
    expect(picked[0]!.artworkRef).toEqual({ kind: 'external', url: 'https://imagenes.passline.com/eventos/b.jpg' })
    expect(toPostEvent(insecure).artworkRef).toBeNull()
    expect(toPostEvent(relative).artworkRef).toBeNull()
  })

  it('counts only the catalog\'s known image origins as artwork', () => {
    const id = 'fcd772a2-9b05-4e1a-b6bc-e5503726a597'
    const key = `${'ab'.repeat(32)}.webp`
    const legacy = `https://baeventos.com/api/event-artwork/${id}/${key}`
    const stored = `r2:image/webp:${key}`
    const elsewhere = ['https://internal.example/flyer.jpg', 'https://10.0.0.5/a.jpg', 'https://baeventos.com/api/admin', 'https://imagenes.passline.com/other/a.jpg', legacy]
      .map((imageUrl, i) => event({ imageUrl, barrio: `Barrio ${i}`, categories: [`c${i}`] }))
    const known = [legacy, stored, stored, 'https://imagenes.passline.com/eventos/a.jpg', 'https://images.venti.live/user-images/a.png', 'https://images.lumacdn.com/event-covers/a.jpg']
      .map((imageUrl, index) => event({ imageUrl, summary: null, id: index === 0 ? id : `00000000-0000-4000-8000-00000000000${index}` }))
    // The disallowed addresses earn no preference, although those events add more variety and have a description.
    const picked = selectEvents([...elsewhere, ...known], 'finde', finde)
    expect(picked.map(p => p.id).sort()).toEqual(known.map(e => e.id).sort())
    for (const other of elsewhere) expect(toPostEvent(other).artworkRef).toBeNull()
    for (const event of known.slice(0, 3)) expect(toPostEvent(event).artworkRef).toEqual({ kind: 'stored', key, contentType: 'image/webp' })
    // They still qualify when there is room.
    expect(selectEvents([...elsewhere, ...known.slice(0, 2)], 'finde', finde)).toHaveLength(6)
  })

  it('honors excluded ids and lists the picks by start time', () => {
    const late = event({ startsAt: '2026-11-22T23:00:00.000Z' })
    const early = event({ startsAt: '2026-11-20T23:00:00.000Z' })
    const gone = event()
    expect(selectEvents([late, gone, early], 'finde', finde, [gone.id]).map(p => p.id)).toEqual([early.id, late.id])
  })
})

describe('tags', () => {
  it("tags the venue's handle, then the source account (as Vía), then nobody", () => {
    expect(toPostEvent(event({ venueHandle: '@salalucida', sourceAccount: 'fidba' }))).toMatchObject({ handle: 'salalucida', via: false })
    expect(toPostEvent(event({ venueHandle: null, sourceAccount: 'fidba' }))).toMatchObject({ handle: 'fidba', via: true })
    expect(toPostEvent(event({ venueHandle: null, sourceAccount: 'salalucida', venue: 'Sala Lúcida —' }))).toMatchObject({ handle: 'salalucida', via: false })
    expect(toPostEvent(event({ venueHandle: null, sourceAccount: null }))).toMatchObject({ handle: null, via: false })
  })
})

describe("the posting account as the venue's own", () => {
  it('matches by name, and not for other accounts', () => {
    expect(accountIsVenue('ccmacedonia', 'Centro Cultural Macedonia')).toBe(true)
    expect(accountIsVenue('bibliotecacafemusica', 'La Biblioteca Café')).toBe(true)
    expect(accountIsVenue('cine.gaumont', 'Cine Gaumont')).toBe(true)
    expect(accountIsVenue('laba.arg', 'LABA')).toBe(true)
    expect(accountIsVenue('vamos_gratis', 'Facultad de Derecho (UBA)')).toBe(false)
    expect(accountIsVenue('instituto.iiet', 'La Vidriera')).toBe(false)
    expect(accountIsVenue('queridamanija', 'C Art Media')).toBe(false)
  })
})

describe('titles naming the venue after an @', () => {
  it('drops the suffix only when it names the venue', () => {
    expect(stripVenueSuffix('JOHNNY MARR @ C ART MEDIA', 'C Art Media')).toBe('JOHNNY MARR')
    expect(stripVenueSuffix('Noche de tango @Café Artigas', 'Cafe artigas')).toBe('Noche de tango')
    expect(stripVenueSuffix('Fiesta @ La Tangente', 'Niceto Club')).toBe('Fiesta @ La Tangente')
    expect(stripVenueSuffix('Hablemos de @usuario y más', 'Sala')).toBe('Hablemos de @usuario y más')
    expect(toPostEvent(event({ name: 'JOHNNY MARR @ C ART MEDIA', venue: 'C Art Media' })).title).toBe('Johnny Marr')
  })
})

describe('the Reel: still running or upcoming at its Friday 18:00 deadline', () => {
  const reel = runWindow('reel', '2026-11-20')
  const at = (hour: number, minute = 0) => baInstant('2026-11-20', hour, minute).toISOString()

  it('leaves out a no-end event that starts by 18:00 and keeps one starting after it', () => {
    expect(qualifies(event({ startsAt: at(12) }), 'reel', reel)).toBe(false)
    expect(qualifies(event({ startsAt: at(17, 59) }), 'reel', reel)).toBe(false)
    expect(qualifies(event({ startsAt: at(18) }), 'reel', reel)).toBe(false)
    expect(qualifies(event({ startsAt: at(18, 1) }), 'reel', reel)).toBe(true)
  })

  it('keeps an event that is still running at 18:00', () => {
    expect(qualifies(event({ startsAt: at(12), endsAt: at(20) }), 'reel', reel)).toBe(true)
    expect(qualifies(event({ startsAt: at(12), endsAt: at(18) }), 'reel', reel)).toBe(false)
  })

  it('leaves the carousel rule alone', () => {
    expect(qualifies(event({ startsAt: at(12) }), 'finde', finde)).toBe(true)
  })

  it('fills the places with the next picks', () => {
    const early = [12, 13, 14].map(hour => event({ startsAt: at(hour) }))
    const late = [19, 20, 21, 22].map(hour => event({ startsAt: at(hour) }))
    expect(selectEvents([...early, ...late], 'reel', reel).map(e => e.id)).toEqual(late.map(e => e.id))
  })
})

it.each([true, false])('keeps a Friday flyer only when Saturday coverage remains possible (alternate venue: %s)', alternate => {
  const friday = (hour: number) => baInstant('2026-11-20', hour).toISOString()
  const saturday = (hour: number) => baInstant('2026-11-21', hour).toISOString()
  const free = event({ venue: 'Sala F', startsAt: friday(19), isFree: true })
  const flyer = event({ venue: 'Sala X', startsAt: friday(20), imageUrl: 'https://imagenes.passline.com/eventos/a.jpg' })
  const plain = event({ venue: 'Sala W', startsAt: friday(21) })
  const sharedVenue = event({ venue: 'Sala X', startsAt: saturday(19) })
  const otherVenue = event({ venue: 'Sala Y', startsAt: alternate ? saturday(20) : friday(22) })
  const pool = [free, flyer, plain, sharedVenue, otherVenue]
  const expected = alternate ? [free, flyer, plain, otherVenue] : [free, plain, otherVenue, sharedVenue]
  expect(selectEvents(pool, 'finde', finde).map(p => p.id)).toEqual(expected.map(e => e.id))
  expect(selectEvents(pool.toReversed(), 'finde', finde).map(p => p.id)).toEqual(expected.map(e => e.id))
})
