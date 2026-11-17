import { describe, expect, it } from 'vitest'
import { baInstant, baLocal, dateRange, descriptionLine, displayTitle, englishDates, longDate, priceLabel, timeLabel, weekdayDay } from './format.ts'
import { activeRuns, runWindow } from './formats.ts'

describe('Spanish dates', () => {
  it('names the Buenos Aires weekday and month', () => {
    expect(weekdayDay('2026-11-20')).toBe('Viernes 20')
    expect(longDate('2026-11-18')).toBe('Miércoles 18 de noviembre')
    expect(baLocal('2026-11-21T02:30:00.000Z')).toMatchObject({ date: '2026-11-20', hour: 23, minute: 30 })
  })

  it('writes a range in one month and across a month change', () => {
    expect(dateRange('2026-11-20', '2026-11-22')).toBe('20 al 22 de noviembre')
    expect(dateRange('2026-11-28', '2026-12-04')).toBe('28 de noviembre al 4 de diciembre')
    expect(dateRange('2026-12-28', '2027-01-03')).toBe('28 de diciembre al 3 de enero')
    expect(englishDates('2026-11-28', '2026-12-04')).toBe('November 28 to December 4')
  })
})

describe('times', () => {
  it('prints 24-hour Buenos Aires time, with a same-day end', () => {
    expect(timeLabel('2026-11-21T00:00:00.000Z', null)).toBe('21:00')
    expect(timeLabel('2026-11-21T14:00:00.000Z', '2026-11-21T19:30:00.000Z')).toBe('11:00 a 16:30')
    // Ends after midnight: only the start.
    expect(timeLabel('2026-11-21T02:00:00.000Z', '2026-11-21T04:00:00.000Z')).toBe('23:00')
  })
})

describe('prices', () => {
  it('formats the pill', () => {
    expect(priceLabel({ isFree: true, price: 0, payWhatYouWant: false })).toBe('Gratis')
    expect(priceLabel({ isFree: false, price: 15000, payWhatYouWant: false })).toBe('$15.000')
    expect(priceLabel({ isFree: false, price: 1250000, payWhatYouWant: false })).toBe('$1.250.000')
    expect(priceLabel({ isFree: false, price: 800, payWhatYouWant: false })).toBe('$800')
    expect(priceLabel({ isFree: false, price: null, payWhatYouWant: true })).toBe('A la gorra')
    expect(priceLabel({ isFree: false, price: null, payWhatYouWant: false })).toBeNull()
  })
})

describe('titles and descriptions', () => {
  it('turns an all-uppercase title into title case and leaves others alone', () => {
    expect(displayTitle('JOHNNY MARR')).toBe('Johnny Marr')
    expect(displayTitle('¡ÚLTIMA FUNCIÓN!')).toBe('¡Última Función!')
    expect(displayTitle('NOCHE DE TANGO Y MILONGA EN EL CLUB')).toBe('Noche de Tango y Milonga en el Club')
    expect(displayTitle('EL ARTE DE LA FUGA')).toBe('El Arte de la Fuga')
    expect(displayTitle('THE LEMON TWIGS AND FRIENDS')).toBe('The Lemon Twigs and Friends')
    expect(displayTitle('DJ SET CON MC LUNA')).toBe('DJ Set con MC Luna')
    expect(displayTitle('FESTIVAL FEJA 2026 VOL. 2')).toBe('Festival Feja 2026 Vol. 2')
    expect(displayTitle('MAGGIE CULLEN - LATINPEÑA')).toBe('Maggie Cullen - Latinpeña')
    expect(displayTitle('Dear Munro')).toBe('Dear Munro')
    expect(displayTitle('FIDBA #15 — Na passagem do trópico')).toBe('FIDBA #15 — Na passagem do trópico')
  })

  it('keeps a first sentence of 90 characters or fewer', () => {
    expect(descriptionLine('Danza y música en vivo. Con invitados.')).toBe('Danza y música en vivo.')
    expect(descriptionLine('x'.repeat(91) + '. Corta.')).toBeNull()
    expect(descriptionLine(null)).toBeNull()
  })
})

describe('schedule', () => {
  it('drafts and publishes each format at its Buenos Aires slot', () => {
    const finde = runWindow('finde', '2026-11-20')
    expect(finde.draftAt.toISOString()).toBe('2026-11-18T21:00:00.000Z')
    expect(finde.publishAt.toISOString()).toBe('2026-11-19T15:00:00.000Z')
    expect(finde.cutoff.toISOString()).toBe('2026-11-20T21:00:00.000Z')
    const gratis = runWindow('gratis', '2026-11-23')
    expect([gratis.from, gratis.to]).toEqual(['2026-11-23', '2026-11-29'])
    expect(gratis.draftAt.toISOString()).toBe('2026-11-22T21:00:00.000Z')
    expect(gratis.cutoff.toISOString()).toBe('2026-11-24T23:00:00.000Z')
    expect(runWindow('hoy', '2026-11-18').publishAt).toEqual(baInstant('2026-11-18', 17))
    expect(() => runWindow('finde', '2026-11-21')).toThrow(/Friday/)
  })

  it('finds the runs whose draft time has come', () => {
    expect(activeRuns('finde', baInstant('2026-11-18', 17, 59))).toEqual([])
    expect(activeRuns('finde', baInstant('2026-11-18', 18))).toEqual(['2026-11-20'])
    expect(activeRuns('hoy', baInstant('2026-11-18', 11, 5))).toEqual(['2026-11-18'])
    expect(activeRuns('hoy', baInstant('2026-11-18', 17))).toEqual([])
    expect(activeRuns('gratis', baInstant('2026-11-22', 18))).toEqual(['2026-11-23'])
  })
})
