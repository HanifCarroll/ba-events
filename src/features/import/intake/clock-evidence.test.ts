import { describe, expect, it } from 'vitest'
import { citesClock, citesDateAndClock } from './clock-evidence.ts'

describe('intake clock tokens', () => {
  it.each([
    ['21h', '21:00'], ['21 hs', '21:00'], ['21:30', '21:30'], ['20.30', '20:30'],
    ['20.00', '20:00'], ['a las 21', '21:00'], ['9 p. m.', '21:00'], ['12 a.m.', '00:00'],
  ])('matches %s as %s', (excerpt, time) => {
    expect(citesClock(excerpt, time)).toBe(true)
  })

  it.each([
    ['de 20 a 24 h', '20:00'], ['de 20 a 24 hs', '20:00'], ['de 20 a 24 horas', '20:00'],
    ['20 a 24 h', '20:00'], ['20 - 24 hs', '20:00'], ['20–2 h', '20:00'], ['de 21 a 23 h', '21:00'],
    ['de 9 a 13 hs', '09:00'], ['20 a 24hs', '20:00'], ['de 20.30 a 24 h', '20:30'],
    ['de 20 a 0 h', '20:00'], ['de 20 a 00 h', '20:00'], ['20–23:30', '20:00'],
    ['desde 20 hasta las 24 h', '20:00'], ['20-24:00', '20:00'],
  ])('matches the start of %s as %s', (excerpt, time) => {
    expect(citesClock(excerpt, time)).toBe(true)
  })

  it.each([
    'del 20 al 24 de noviembre', 'de 20 a 24 años', 'entre 20 y 24 personas', '20 a 24 cuotas',
    'de 20 a 23 personas. Puertas 22 h', '20 en sala A - 24 h', 'de 20 a 23, 22 hs',
    '20 a 23', '$20 a 24 h', 'ARS 20 a 24 h', 'USD 20:00 a 24 h', '20 a $23 h', '20 a 24:30 h',
    'viernes 20 a las 21 hs', '2026-11-20 - 21:00',
  ])('does not infer a start hour from %s', excerpt => {
    expect(citesClock(excerpt, '20:00')).toBe(false)
  })

  it.each([
    ['de 9 a 13 horas', '09:00', '13:00', '13 horas'],
    ['20:00–23:30', '20:00', '23:30', '23:30'],
    ['de 8 pm a 11 pm', '20:00', '23:00', '11 pm'],
    ['20 a 00 h', '20:00', '00:00', '00 h'],
  ])('only uses the opening clock in %s', (range, start, end, endQuote) => {
    expect(citesClock(range, start)).toBe(true)
    expect(citesClock(range, end)).toBe(false)
    expect(citesClock(endQuote, end, range)).toBe(false)
    const independent = `${range}. Show: ${endQuote}`
    expect(citesClock(independent, end)).toBe(true)
    expect(citesClock(endQuote, end, independent)).toBe(true)
    expect(citesClock(independent, end, independent, 2)).toBe(false)
  })

  it.each([
    ['día 21 - 18:00 hs', '21:00', '18:00'],
    ['Del 18 al 20 - 21 hs', '20:00', '21:00'],
    ['Viernes 20 - 23 hs', '20:00', '23:00'],
    ['vie 20 – 23 hs', '20:00', '23:00'],
    ['sábado 15 - 21 hs', '15:00', '21:00'],
    ['Miérc. el 15 - 21 hs', '15:00', '21:00'],
    ['noviembre 20 - 21 hs', '20:00', '21:00'],
    ['+18 - 23 hs', '18:00', '23:00'],
    ['20/11 - 21 hs', '11:00', '21:00'],
    ['20 / 11 - 21 hs', '11:00', '21:00'],
  ])('does not turn the day or rating in %s into a clock', (excerpt, day, time) => {
    expect(citesClock(excerpt, day)).toBe(false)
    expect(citesClock(excerpt, time)).toBe(true)
  })

  it.each([
    'Viernes de 20 - 23 hs', 'Viernes desde 20 – 23 hs', 'Viernes de las 20 a las 23 hs',
    'Viernes. Horario: 20 - 23 hs', 'Viernes\n20 - 23 hs', 'Viernes 20 hs - 23 hs',
  ])('accepts a real range start in %s', excerpt => {
    expect(citesClock(excerpt, '20:00')).toBe(true)
    expect(citesClock(excerpt, '23:00')).toBe(false)
  })

  it.each([
    ['10–15.50', '10:00'], ['Precios: 10–15.50 USD', '15:50'], ['10–15.50 USD', '10:00'],
    ['10–15:50 ARS', '10:00'], ['10 a 15 hs pesos', '10:00'], ['10 a 15 hs $', '15:00'],
    ['10:00–15:50 (USD)', '10:00'], ['Precios: 10–15:50', '10:00'],
    ['10–15:50 $', '15:50'], ['$10–15 hs', '15:00'],
  ])('does not infer or cite a price as a clock in %s', (excerpt, time) => {
    expect(citesClock(excerpt, time)).toBe(false)
  })

  it('still reads a clock range when the end has a colon or a time unit and the price is separate', () => {
    expect(citesClock('Precios: 10–15.50 USD. Horario: 20–23:30', '20:00')).toBe(true)
    expect(citesClock('Horario: 20–23.30 hs; precio $10', '20:00')).toBe(true)
  })

  it.each(['Duración: de 2 a 3 horas', 'dura 2 a 3 hs', 'Duración estimada: 02:00 a 03:00', 'de 2 a 3 horas de duración'])('does not use either duration bound in %s', duration => {
    expect(citesClock(duration, '02:00')).toBe(false)
    expect(citesClock(duration, '03:00')).toBe(false)
    expect(citesClock(`${duration}. Show de 2 a 3 hs`, '02:00')).toBe(true)
  })

  it('does not join range endpoints across a separately cited sale date', () => {
    expect(citesDateAndClock('20 a 15/11 24 h', '2026-11-15', '20:00')).toBe(false)
    expect(citesDateAndClock('15/11 de 20 a 24 h', '2026-11-15', '20:00')).toBe(true)
  })

  it('does not match 24 as a start or turn it into 00:00', () => {
    for (const excerpt of ['24 h', '24:00', 'de 20 a 24 h', 'de 20 a 24:00']) {
      expect(citesClock(excerpt, '24:00')).toBe(false)
      expect(citesClock(excerpt, '00:00')).toBe(false)
    }
  })

  it('does not infer an ambiguous start from an end with meridiem', () => {
    expect(citesClock('de 8 a 11 pm', '08:00')).toBe(false)
    expect(citesClock('de 8 a 11 pm', '20:00')).toBe(false)
    expect(citesClock('de 8 a 11 pm', '23:00')).toBe(true)
  })

  it('requires the closing clock and its unit in the quote when they establish the start', () => {
    const source = 'Show de 20 a 24 hs.'
    expect(citesClock('20', '20:00', source)).toBe(false)
    expect(citesClock('20 a 24', '20:00', source)).toBe(false)
    expect(citesClock('20 a 24 h', '20:00', source)).toBe(false)
    expect(citesClock('20 a 24 hs', '20:00', source)).toBe(true)
  })

  it('does not count range endpoints as separate same-time citations', () => {
    const range = 'de 21 a 21 hs'
    expect(citesClock(range, '21:00', range, 2)).toBe(false)
    const both = `${range}. Show: 21 hs`
    expect(citesClock(both, '21:00', both, 2)).toBe(true)
  })

  it('checks the source token before allowing a quote that ends partway through it', () => {
    expect(citesClock('a las 21', '21:00', 'a las 21:30')).toBe(false)
    expect(citesClock('9:30', '09:30', '9:30 p. m.')).toBe(false)
    expect(citesClock('8:30 p. m.', '20:30', '9:30 p. m.')).toBe(false)
  })

  it('does not use dates as clocks', () => {
    for (const date of ['20.11', '20.11.2026', '20/11', '2026-11-20']) expect(citesClock(date, '20:11')).toBe(false)
  })
})
