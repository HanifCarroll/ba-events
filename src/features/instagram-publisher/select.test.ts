import { describe, expect, it } from 'vitest'
import { baInstant } from './format.ts'
import { runWindow } from './formats.ts'
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
    const art = 'https://baeventos.com/api/event-artwork/a/b.jpg'
    const plain = Array.from({ length: 5 }, (_, i) => event({ barrio: `Barrio ${i}`, categories: [`c${i}`] }))
    const flyers = Array.from({ length: 4 }, () => event({ barrio: 'Palermo', summary: null, imageUrl: art, startsAt: '2026-11-22T23:00:00.000Z' }))
    const picked = selectEvents([...plain, ...flyers], 'finde', finde)
    expect(picked).toHaveLength(6)
    expect(picked.filter(p => p.imageUrl).map(p => p.id)).toEqual(flyers.map(e => e.id))
    expect(picked.filter(p => !p.imageUrl)).toHaveLength(2)
    // Not enough flyers to fill the post: the rest still qualify.
    expect(selectEvents(plain, 'finde', finde)).toHaveLength(5)
    expect(toPostEvent(event({ imageUrl: '  ' })).imageUrl).toBeNull()
  })

  it('still shows one event per venue when only the later one has artwork', () => {
    const plain = event({ venue: 'Sala Lúcida' })
    const flyer = event({ venue: 'Sala Lucida —', startsAt: '2026-11-21T22:00:00.000Z', imageUrl: 'https://img.example/a.jpg' })
    expect(selectEvents([plain, flyer], 'finde', finde).map(p => p.id)).toEqual([flyer.id])
  })

  it('picks the Reel like the carousel: flyer-less events and the only free event are never dropped', () => {
    const reel = runWindow('reel', '2026-11-20')
    const at = (hour: number) => ({ startsAt: `2026-11-22T${hour}:00:00.000Z` })
    const flyers = Array.from({ length: 4 }, (_, i) => event({ ...at(20 + (i % 3)), price: 5000, imageUrl: `https://img.example/${i}.jpg` }))
    const plain = event({ ...at(21), price: 5000 })
    const free = event({ ...at(22), isFree: true, price: 0 })
    const picked = selectEvents([...flyers, plain, free], 'reel', reel)
    expect(picked).toHaveLength(6)
    expect(picked.map(p => p.id)).toContain(free.id)
    expect(picked.filter(p => p.imageUrl)).toHaveLength(4)
    expect(new Set(picked.map(p => p.id))).toEqual(new Set(selectEvents([...flyers, plain, free], 'finde', finde).map(p => p.id)))
    // With more candidates than places, the ones with flyers still win the remaining places.
    const more = Array.from({ length: 4 }, (_, i) => event({ ...at(20), barrio: `Barrio ${i}`, categories: [`c${i}`] }))
    const crowded = selectEvents([...flyers, plain, free, ...more], 'reel', reel)
    expect(crowded.map(p => p.id)).toContain(free.id)
    expect(crowded.filter(p => p.imageUrl)).toHaveLength(4)
  })

  it('counts only an https address as artwork', () => {
    const insecure = event({ imageUrl: 'http://img.example/a.jpg', barrio: 'Boedo', categories: ['x'] })
    const relative = event({ imageUrl: '//img.example/a.jpg', barrio: 'Flores', categories: ['y'] })
    const secure = Array.from({ length: 6 }, () => event({ imageUrl: ' https://img.example/b.jpg ', summary: null }))
    const picked = selectEvents([insecure, relative, ...secure], 'finde', finde)
    expect(picked.map(p => p.id).sort()).toEqual(secure.map(e => e.id).sort())
    expect(picked[0]!.imageUrl).toBe('https://img.example/b.jpg')
    expect(toPostEvent(insecure).imageUrl).toBeNull()
    expect(toPostEvent(relative).imageUrl).toBeNull()
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
