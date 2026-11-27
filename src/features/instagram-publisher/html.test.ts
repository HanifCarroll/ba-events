/** The still frames' structure: the flyer-led card, the no-flyer card, and the story bands. Words are checked in copy.test.ts. */
import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import type { Artwork } from './artwork.ts'
import { runWindow } from './formats.ts'
import { CARD, LAYOUT_VERSION, MENTION_SLACK, STICKER_BAND, STICKER_Y, STORY_SAFE, framesHtml, mentionArea } from './html.ts'
import { eventFrameTag } from './instagram.ts'
import type { PostEvent } from './select.ts'
import { stickerFrames } from './story-stickers.ts'

const assets = { fontsDir: '/fonts', logo: '/logo.svg' }
const event = (n: number, title = `Evento ${n}`): PostEvent =>
  ({ id: `e${n}`, date: '2026-11-21', startsAt: '', title, time: '21:00', description: 'Una noche de música.', venue: `Sala ${n}`, barrio: 'Boedo', price: n === 1 ? 'Gratis' : '$8.000', handle: n === 3 ? null : `sala${n}`, artworkRef: null, via: n === 2 })
const events = [1, 2, 3, 4].map(n => event(n))
const art = (n: number, width: number, height: number) => ({ file: `/art/${n}.jpg`, backdrop: `/art/${n}-bg.jpg`, width, height })
// Portrait 4:5, tall 9:16, and landscape; event 4 has no artwork.
const artwork: Artwork = { e1: art(1, 1024, 1280), e2: art(2, 720, 1280), e3: art(3, 1280, 720) }
const px = (style: string | undefined, name: string) => Number(new RegExp(`(?:^|;)${name}:(-?\\d+)px`).exec(style ?? '')?.[1])

describe.each([['finde', '2026-11-20', 1350, 'carousel'], ['hoy', '2026-11-21', 1920, 'story']] as const)('%s frames', (format, day, height, kind) => {
  const $ = load(framesHtml(format, runWindow(format, day), events, assets, artwork))
  const frames = $('.s')
  const cards = frames.filter('[data-frame="card"]')

  it('has a cover, one card per event, and a closing frame, with the logo on each', () => {
    expect(frames.map((_, frame) => $(frame).attr('data-frame')).get()).toEqual(['cover', 'card', 'card', 'card', 'card', 'closing'])
    frames.each((_, frame) => { expect($(frame).find('img.logo').attr('src')).toBe('/logo.svg') })
    expect($.html()).not.toContain('hero-rooftop')
  })

  it('shows each flyer whole, above the panel, over its own blur', () => {
    cards.slice(0, 3).each((index, card) => {
      const flyer = $(card).find('[data-flyer]')
      const source = artwork[`e${index + 1}`]!
      expect(flyer.attr('src')).toBe(source.file)
      expect($(card).find('.zone img.fill').attr('src')).toBe(source.backdrop)
      const style = flyer.attr('style')
      const [left, top, width, boxHeight] = ['left', 'top', 'width', 'height'].map(name => px(style, name)) as [number, number, number, number]
      expect(width / boxHeight).toBeCloseTo(source.width / source.height, 2) // never cropped or stretched
      expect(left).toBeGreaterThanOrEqual(40)
      expect(left + width).toBeLessThanOrEqual(1040)
      expect(top + boxHeight).toBeLessThan(CARD[kind].seam)
      // A carousel's panel starts at the seam. A story's is sized by its words, and the page grows the flyer down to it.
      if (kind === 'carousel') expect(px($(card).find('.panel').attr('style'), 'top')).toBe(CARD.carousel.seam)
      else {
        expect($(card).find('.zone').attr('data-until')).toBe(`c${index + 1}-panel`)
        expect($(card).find(`#c${index + 1}-panel [data-role]`).length).toBeGreaterThanOrEqual(6)
        expect(flyer.attr('data-ratio')).toBe(`${source.width},${source.height}`)
        expect(px($(card).find('.zone').attr('style'), 'height')).toBe(1920) // the blur fills the frame, under the panel too
      }
    })
  })

  it('gives an event without artwork a titled tile in the flyer\'s place', () => {
    const card = cards.eq(3)
    expect(card.find('[data-flyer]')).toHaveLength(0)
    expect(card.find('[data-fallback] [data-role="tile-title"]').text()).toBe('Evento 4')
    expect(card.find('[data-role="title"]').text()).toBe('Evento 4')
  })

  it('fits titles to two lines with a size floor, and sets no essential text under 32 px', () => {
    cards.each((_, card) => {
      const [, floor, lines] = $(card).find('[data-role="title"]').attr('data-fit')!.split(',').map(Number)
      expect(lines).toBe(2)
      expect(floor).toBeGreaterThanOrEqual(40)
    })
    const sizes = Array.from($.html().matchAll(/font-size:(\d+)px/g), ([, size]) => Number(size))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(32)
  })

  it('puts the tag on the footer handle, inside the panel', () => {
    const tag = eventFrameTag(events, 2, height, LAYOUT_VERSION)!
    expect(tag.username).toBe('sala2')
    expect(tag.y * height).toBeGreaterThan(CARD[kind].seam)
    expect(Math.abs(tag.y * height - CARD[kind].footer.centerY)).toBeLessThan(1) // the tag is rounded to a thousandth of the frame
    // A story draws "Vía" in its own cell, so the mention pill can cover the handle alone.
    const foot = cards.eq(1).find('[data-role="foot"]')
    if (kind === 'story') expect([foot.find('[data-via]').text(), foot.find('[data-handle]').text(), foot.find('[data-site]').text()]).toEqual(['Vía', '@sala2', 'baeventos.com'])
    else expect(foot.find('span').first().text()).toBe('Vía @sala2')
    if (kind === 'carousel') expect(px(cards.eq(1).find('[data-role="foot"]').attr('style'), 'top') + 20).toBe(CARD.carousel.footer.centerY)
    expect(eventFrameTag(events, 3, height, LAYOUT_VERSION)).toBeNull()
  })
})

describe('story bands', () => {
  const frames = stickerFrames(['cover', 'a', 'b', 'c', 'd', 'close'], events, LAYOUT_VERSION)
  const band = (centerY: number) => [centerY - 80, centerY + 80] as const

  it('keeps every link sticker inside the safe band', () => {
    for (const frame of frames) {
      const [top, bottom] = band(frame.centerY)
      expect(top).toBeGreaterThanOrEqual(STORY_SAFE.top)
      expect(bottom).toBeLessThanOrEqual(STORY_SAFE.bottom)
    }
    expect(frames.map(frame => frame.centerY)).toEqual([STICKER_Y.cover, STICKER_Y.event, STICKER_Y.event, STICKER_Y.event, STICKER_Y.event, STICKER_Y.closing])
  })

  it('leaves the event frame\'s sticker band below the panel, and puts the mention on the footer handle', () => {
    expect(band(STICKER_Y.event)[0]).toBeGreaterThanOrEqual(CARD.story.bottom)
    // The footer is the panel's last row: 40 px tall, with the same room above it (to the barrio row) as below it.
    const { centerY, gap, pad } = CARD.story.footer
    expect(centerY).toBe(CARD.story.bottom - pad - 20)
    expect(gap).toBe(pad)
    const at = frames[1]!.mentionAt!
    expect(at.centerY).toBe(centerY)
    // A 90 px pill centred there stays under the barrio row and above the link sticker's band, with room to spare.
    expect(at.area).toMatchObject({ top: centerY - 20 - gap, bottom: CARD.story.bottom })
    expect(at.centerY - 45).toBeGreaterThanOrEqual(at.area!.top + 4)
    expect(at.centerY + 45).toBeLessThanOrEqual(at.area!.bottom - 4)
    expect(at.area!.bottom).toBeLessThanOrEqual(STICKER_BAND.event[0])
  })

  it('centres the event frame\'s link sticker in its band, with equal slack above and below', () => {
    const [top, bottom] = STICKER_BAND.event
    expect(STICKER_Y.event).toBe(1577)
    expect(STICKER_Y.event - 80 - top).toBe(bottom - (STICKER_Y.event + 80))
    expect(STICKER_Y.event - 80 - top).toBe(13)
  })

  it('gives each link sticker a free band that holds its 160 px and ends above the reply bar', () => {
    expect(frames.map(frame => frame.band)).toEqual([STICKER_BAND.cover, STICKER_BAND.event, STICKER_BAND.event, STICKER_BAND.event, STICKER_BAND.event, STICKER_BAND.closing])
    for (const frame of frames) {
      expect(frame.centerY - 80).toBeGreaterThanOrEqual(frame.band![0])
      expect(frame.centerY + 80).toBeLessThanOrEqual(frame.band![1])
      expect(frame.band![1]).toBeLessThanOrEqual(STORY_SAFE.bottom)
    }
    expect(STICKER_BAND.event).toEqual([CARD.story.bottom, 1670])
  })

  it('shrinks a long "Vía @handle" to fit its side of the footer, and cuts it only at the floor', () => {
    const $ = load(framesHtml('hoy', runWindow('hoy', '2026-11-21'), events, assets, artwork))
    const handle = $('[data-frame="card"]').eq(1).find('[data-handle]')
    const { left, right, size, floor, via, viaText, site } = CARD.story.footer
    const area = mentionArea(true)
    // The handle starts after the "Vía" cell and is no wider than the widest pill, which stops short of the area's end.
    const width = area.right - MENTION_SLACK - (left + via)
    expect(handle.attr('data-fit-width')).toBe(`${size},${floor},${width}`)
    expect(handle.attr('style')).toContain(`max-width:${width}px`)
    expect(handle.hasClass('one')).toBe(true)
    expect(floor).toBeGreaterThanOrEqual(32)
    // "@" and a 30-character username fit at the floor (a rendered sample measured 0.51 em a character).
    expect(31 * floor * 0.51).toBeLessThanOrEqual(width)
    // "Vía" (3 characters, at about 0.54 em each) fits the part of its cell the pill's area leaves alone, and the address its reserved end.
    expect(3 * size * 0.54).toBeLessThanOrEqual(viaText)
    expect(area.left).toBe(left + viaText)
    expect(13 * size * 0.54).toBeLessThanOrEqual(site)
    expect(area.right).toBeLessThan(right - site)
    // A venue's own handle has no "Vía": it starts at the row's left edge and has more room.
    const own = $('[data-frame="card"]').eq(0)
    expect(own.find('[data-via]')).toHaveLength(0)
    expect(own.find('[data-handle]').attr('data-fit-width')).toBe(`${size},${floor},${mentionArea(false).right - MENTION_SLACK - left}`)
    // No handle: only the site's address.
    expect($('[data-frame="card"]').eq(2).find('[data-role="foot"] span').map((_, el) => $(el).text()).get()).toEqual(['baeventos.com'])
  })

  it('ends the cover\'s headline box above its sticker band and starts the footer below it', () => {
    const $ = load(framesHtml('hoy', runWindow('hoy', '2026-11-21'), events, assets, artwork))
    const cover = $('.s').first()
    // Flyers run from the top of the frame to the bottom: the grid, then a second row behind the headline and below it.
    const cells = cover.find('.frame').map((_, cell) => [[px($(cell).attr('style'), 'top'), px($(cell).attr('style'), 'height')]]).get() as unknown as Array<[number, number]>
    expect(Math.min(...cells.map(([top]) => top))).toBe(0)
    expect(Math.max(...cells.map(([top, height]) => top + height))).toBe(1920)
    expect(1920 - px(cover.find('.stack').attr('style'), 'bottom')).toBeLessThanOrEqual(band(STICKER_Y.cover)[0])
    expect(px(cover.find('[data-role="foot"]').attr('style'), 'top')).toBeGreaterThanOrEqual(band(STICKER_Y.cover)[1])
    const closing = $('.s').last()
    expect(px(closing.find('[data-role="foot"]').attr('style'), 'top')).toBeGreaterThanOrEqual(band(STICKER_Y.closing)[1])
  })
})
