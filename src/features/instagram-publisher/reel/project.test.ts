/** The Reel's timing rule and generated project, on synthetic picks. */
import { describe, expect, it } from 'vitest'
import { runWindow } from '../formats.ts'
import type { PostEvent } from '../select.ts'
import { REEL_FAILURE, holdFor, reelProject, reelTiming } from './project.ts'

const event = (n: number, title: string, price: string | null = null): PostEvent =>
  ({ id: `e${n}`, date: '2026-11-21', startsAt: '', title, time: '21:00', description: 'Ignored on the Reel.', venue: `Sala ${n}`, barrio: 'Boedo', price, handle: `sala${n}`, imageUrl: null, via: false })
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
    for (const text of ['20 al 22 de noviembre', '6 planes para este finde en Buenos Aires', 'src="assets/logo.svg"']) {
      expect(cover).toContain(text)
    }
    expect(cover).not.toContain('hero-rooftop')
    expect(files['compositions/e1.html']).toContain('Sábado 21 · 21:00')
    expect(files['compositions/e1.html']).toContain('class="pill free" data-role="pill">Gratis<')
    expect(files['compositions/e3.html']).toContain('Jazz &lt;en&gt; &quot;vivo&quot;')
    expect(files['compositions/e3.html']).toContain('class="pill" data-role="pill">$15.000<')
    expect(files['compositions/e2.html']).not.toContain('class="pill')
    for (const html of Object.values(files)) {
      expect(html).not.toContain('Ignored on the Reel.')
      expect(html).not.toContain('@sala')
      expect(html).not.toMatch(/https?:\/\//) // nothing is fetched at render time
    }
    expect(files['compositions/closing.html']).toContain('Encontrá más planes')
    expect(files['index.html']).toContain('src="assets/music.wav"')
  })

  it('shows each flyer whole over its own blur, and a titled tile when an event has none', () => {
    const artwork = { e2: { file: 'assets/art/art-2.jpg', backdrop: 'assets/art/art-2-bg.jpg', width: 1080, height: 1920 } }
    const files = reelProject(window, six, reelTiming(window, six, 120), artwork)
    const flyer = files['compositions/e2.html']!
    expect(flyer).toMatch(/data-flyer data-ratio="1080,1920" data-boxes="[\d,;]+" src="assets\/art\/art-2\.jpg"/)
    expect(flyer).toContain('id="e2-zone" class="zone" style="height:1920px" data-until="e2-panel"') // the blur fills the frame
    expect(flyer).toContain('class="fill" src="assets/art/art-2-bg.jpg"')
    // 9:16 inside the tall box: the whole flyer, never cropped.
    const [, w, h] = /data-flyer[^>]*width:(\d+)px;height:(\d+)px/.exec(flyer)!
    expect(Number(w) / Number(h)).toBeCloseTo(1080 / 1920, 2)
    const tile = files['compositions/e1.html']!
    expect(tile).toContain('data-fallback')
    expect(tile).not.toContain('data-flyer')
    expect(tile.match(/Muestra anual del Taller de Arte Daniela Lucero: 10 años/g)).toHaveLength(2) // the tile and the panel
    // The cover and the closing card use only the events that have artwork.
    expect(files['compositions/cover.html']!.match(/assets\/art\/art-2\.jpg/g)).toHaveLength(1)
    expect(files['compositions/cover.html']).toContain('class="fill" src="assets/art/art-2-bg.jpg"')
    expect(files['compositions/closing.html']).toContain('assets/art/art-2.jpg')
  })

  it('registers a timeline and reports the failure when a card\'s fonts don\'t load, so the render never hangs', () => {
    const files = reelProject(window, six, reelTiming(window, six, 120))
    for (const id of ['cover', 'e1', 'e6', 'closing']) {
      const html = files[`compositions/${id}.html`]!
      const [, failed] = html.split('}).catch(function (error) {')
      expect(failed, id).toContain(`window.__timelines["${id}"] = gsap.timeline({ paused: true });`)
      expect(failed, id).toContain(`console.error("${REEL_FAILURE}: ${id}: "`)
    }
  })

  it('moves only the flyer during the hold: a slow zoom, with every word landed within 0.5 s of the cut', () => {
    const artwork = { e2: { file: 'assets/art/a.jpg', backdrop: 'assets/art/a-bg.jpg', width: 800, height: 1000 } }
    const timing = reelTiming(window, six, 120)
    const files = reelProject(window, six, timing, artwork)
    const card = files['compositions/e2.html']!
    const length = timing.cards.find(c => c.id === 'e2')!.length
    expect(card).toContain(`tl.fromTo("#e2-fly", { scale: 1 }, { scale: 1.04, duration: ${length}, ease: "none" }, 0);`)
    expect(files['compositions/e1.html']).not.toContain('-fly"')
    const entrances = Array.from(card.matchAll(/tl\.fromTo\("#e2-(kicker|title|venue|meta|pill|zone)", .*?, (?:LAND|\{[^}]*duration: ([\d.]+)[^}]*\}), ([\d.]+)\);/g))
    expect(entrances.map(([, id]) => id)).toEqual(['zone', 'kicker', 'title', 'venue', 'meta'])
    expect(card).toContain('tl.fromTo("#e2-panel", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, 0);')
    for (const [, , duration, at] of entrances) expect(Number(at) + Number(duration ?? 0.32)).toBeLessThanOrEqual(0.5)
    // The cover is the thumbnail: nothing enters, it only leaves.
    expect(files['compositions/cover.html']!.match(/tl\.fromTo/g)).toHaveLength(1)
    expect(files['compositions/cover.html']).toContain(`OUT, ${timing.cards[0]!.length - 0.2}`)
  })
})
