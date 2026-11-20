/** The Reel's timing rule and generated project, on synthetic picks. */
import { describe, expect, it } from 'vitest'
import { runWindow } from '../formats.ts'
import type { PostEvent } from '../select.ts'
import { holdFor, reelProject, reelTiming } from './project.ts'

const event = (n: number, title: string, price: string | null = null): PostEvent =>
  ({ id: `e${n}`, date: '2026-11-21', startsAt: '', title, time: '21:00', description: 'Ignored on the Reel.', venue: `Sala ${n}`, barrio: 'Boedo', price, handle: `sala${n}`, via: false })
const window = runWindow('reel', '2026-11-20')
const six = [event(1, 'Muestra anual del Taller de Arte Daniela Lucero: 10 años', 'Gratis'), event(2, 'Mondongo'), event(3, 'Jazz <en> "vivo"', '$15.000'), event(4, 'Ciclo'), event(5, 'Yoga'), event(6, 'CBB')]

describe('Reel timing', () => {
  it('holds H = max(3 s, 0.35 s a word, C / 17) and rounds each card up to whole beats', () => {
    // v2's cover at 90 BPM: W 12, C 59, H 4.2 s, 8 beats.
    expect(holdFor(['BA Eventos', '20 al 22 de noviembre', 'Este finde', 'en Buenos Aires'], 60 / 90)).toMatchObject({ W: 12, C: 59, beats: 8 })
    expect(holdFor(['a'], 0.5).H).toBe(3)
    expect(holdFor(['a'], 0.5).beats).toBe(8) // 0.5 + 3 + 0.2 = 3.7 s → 7.4 → 8 beats
  })

  it('cuts every card on a beat, rounded to a frame from its own beat index', () => {
    const timing = reelTiming(window, six, 90)
    expect(timing.cards.map(card => card.id)).toEqual(['cover', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'closing'])
    for (const card of timing.cards) {
      const beats = card.start / (60 / 90)
      expect(Math.abs(beats - Math.round(beats)) * (60 / 90)).toBeLessThanOrEqual(1 / 60)
      expect(Math.abs(card.start * 30 - Math.round(card.start * 30))).toBeLessThan(0.05)
    }
    expect(timing.cards.at(-1)!.end).toBe(timing.total)
    expect(timing.cards[0]!.start).toBe(0)
  })

  it('takes 4 to 6 events only', () => {
    expect(() => reelTiming(window, six.slice(0, 3), 90)).toThrow(/4 to 6/)
    expect(() => reelTiming(window, [...six, event(7, 'x')], 90)).toThrow(/4 to 6/)
  })
})

describe('Reel project', () => {
  it('builds the cards from copy.md, escapes titles, and has no description or handle on the cards', () => {
    const files = reelProject(window, six, reelTiming(window, six, 120))
    expect(Object.keys(files).sort()).toEqual(['compositions/closing.html', 'compositions/cover.html', ...[1, 2, 3, 4, 5, 6].map(n => `compositions/e${n}.html`), 'hyperframes.json', 'index.html', 'meta.json'].sort())
    const cover = files['compositions/cover.html']
    for (const text of ['BA Eventos', '20 al 22 de noviembre', 'Este finde', 'en Buenos Aires']) {
      expect(cover).toContain(text)
    }
    expect(files['compositions/e1.html']).toContain('Sábado 21 · 21:00')
    expect(files['compositions/e1.html']).toContain('pill free tx">Gratis<')
    expect(files['compositions/e3.html']).toContain('Jazz &lt;en&gt; &quot;vivo&quot;')
    expect(files['compositions/e3.html']).toContain('class="pill tx">$15.000<')
    expect(files['compositions/e2.html']).not.toContain('class="pill')
    for (const html of Object.values(files)) {
      expect(html).not.toContain('Ignored on the Reel.')
      expect(html).not.toContain('@sala')
      expect(html).not.toMatch(/https?:\/\//) // nothing is fetched at render time
    }
    expect(files['compositions/closing.html']).toContain('Encontrá más planes')
    expect(files['index.html']).toContain('src="assets/music.wav"')
  })
})
