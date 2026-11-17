import { describe, expect, it } from 'vitest'
import { runWindow } from './formats.ts'
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
    expect(toPostEvent(event({ name: 'JOHNNY MARR @ C ART MEDIA', venue: 'C Art Media' })).title).toBe('Johnny marr')
  })
})
