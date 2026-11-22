/** The frames as one HTML page, in the website's look: one `.s` element per frame. The words come from copy.ts. */
import type { Artwork } from './artwork.ts'
import { CLOSING, HOY_CLOSING, SITE, cardKicker, cover, footerHandle, type Cover } from './copy.ts'
import { FORMATS, type FormatKey, type RunWindow } from './formats.ts'
import { ARROW, FIT_JS, INK, LIME, LOOK_CSS, PAPER, SOFT, artOf, collage, esc, flyerZone, fontFaces, grid, logoImg, mosaic } from './look.ts'
import type { Box } from './look.ts'
import type { PostEvent } from './select.ts'

export const FRAME = { story: { width: 1080, height: 1920 }, carousel: { width: 1080, height: 1350 } } as const

/** Instagram covers a story's top 250 px (progress bar, account) and bottom 250 px (reply bar). */
export const STORY_SAFE = { top: 250, bottom: 1670 } as const

/**
 * Where a card's panel starts, and where its footer handle sits (the Instagram tag and the story's mention sticker
 * point at it). A carousel's panel always starts at its seam. A story's panel is only as tall as its words, ends at
 * `bottom` (above the link sticker's band), and never starts above its seam; the flyer grows into what it leaves.
 */
export const CARD = {
  carousel: { seam: 820, footer: { left: 80, centerY: 1296, size: 34 } },
  // The footer row is 40 px tall, with `gap` px above it (to the barrio row) and `pad` px below it (to the panel's end),
  // so the mention pill over the handle has the same room on both sides. On a curator's card "Vía" has its own `via` px
  // cell and the handle starts after it; the site's address keeps the last `site` px of the row.
  story: { seam: 920, bottom: 1484, footer: { left: 80, right: 1000, centerY: 1432, size: 36, floor: 32, gap: 32, pad: 32, via: 96, viaText: 64, site: 270 } },
} as const

/** Room kept between the mention pill and the end of its area, so a drag that lands a little off still fits. */
export const MENTION_SLACK = 16

/**
 * The rectangle a story's mention pill must stay inside, in frame pixels, and where its left edge is aimed. It holds
 * only the printed handle, which the pill covers on purpose: "Vía" is left of it, the site's address right of it, the
 * barrio row above it, and the link sticker's band below it.
 */
export function mentionArea(via: boolean) {
  const { left, right, centerY, gap, via: cell, viaText, site } = CARD.story.footer
  return {
    left: via ? left + viaText : 44,
    right: right - site - 10,
    top: centerY - 20 - gap,
    bottom: CARD.story.bottom,
    aim: { left: (via ? left + cell : left) - 14, centerY },
  }
}

/**
 * Bumped whenever a sticker, tag, or footer position moves. Each draft saves the version its frames were rendered
 * with, and publishing uses that version's coordinates; a draft from before versions existed has none (LEGACY_LAYOUT).
 */
export const LAYOUT_VERSION = 2

/** The positions the frames had before the flyer-led redesign, for drafts rendered then and published after it. */
export const LEGACY_LAYOUT = {
  sticker: { cover: 1440, event: 1440, closing: 1390 },
  mention: { left: 66, centerY: 1618 },
  /** The footer handle: 28 px DM Sans at left 80, 72 px from the bottom. */
  tag: (height: number, text: string) => ({ x: (80 + text.length * 15 / 2) / 1080, y: (height - 72 - 18) / height }),
} as const

/**
 * The centre line of each story frame's link sticker (about 160 px tall), in a band the layout leaves empty: under the
 * headline box on the cover, under the footer on an event frame, and between the body and the footer on the closing frame.
 */
export const STICKER_Y = { cover: 1440, event: (CARD.story.bottom + STORY_SAFE.bottom) / 2, closing: 1390 } as const

/**
 * The band each link sticker must stay inside, top and bottom: no words are in it, and it ends above the reply bar.
 * An event frame's sticker is aimed at the middle of its band, so a drag that lands a little high or low still fits.
 */
export const STICKER_BAND = {
  cover: [STICKER_Y.cover - 104, 1596],
  event: [CARD.story.bottom, STORY_SAFE.bottom],
  closing: [1100, 1596],
} as const

export interface Assets { fontsDir: string; logo: string }

const withArrow = (text: string) => esc(text).replace(' →', ARROW)

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;background:#000}
.s{position:relative;width:1080px;overflow:hidden;color:${PAPER};font-family:'DM Sans',sans-serif;background:${INK}}
.count{position:absolute;right:72px;background:${INK};border-radius:999px;font-size:36px;font-weight:600;line-height:1;padding:7px 20px;font-variant-numeric:tabular-nums}
.panel{position:absolute;left:0;width:1080px;bottom:0;background:${INK};padding:26px 80px 0}
.kicker{color:${LIME};font-weight:700;line-height:1.1;letter-spacing:.06em;text-transform:uppercase}
.title{line-height:1.05;overflow-wrap:anywhere;margin-top:10px}
.desc{color:${SOFT};line-height:1.28;margin-top:10px;-webkit-line-clamp:2}
.where{position:absolute;left:80px;right:80px}
.venue{font-weight:600;line-height:1.15}
.meta{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:4px}
.barrio{color:${SOFT};line-height:1.2;min-width:0}
.foot{position:absolute;left:80px;right:80px;display:flex;justify-content:space-between;color:${SOFT};white-space:nowrap}
.stack{position:absolute;left:30px;right:30px;display:flex;flex-direction:column;align-items:flex-start}
.stack .chip{font-size:44px;padding:12px 20px;margin-bottom:10px}
.stack .hbox{padding:20px 26px 26px}
.spanel{position:absolute;left:40px;right:40px;bottom:${FRAME.story.height - CARD.story.bottom}px;background:${INK};border-radius:24px;padding:24px 40px ${CARD.story.footer.pad}px}
.spanel .venue{margin-top:26px}
.frow{display:flex;color:${SOFT};white-space:nowrap;margin-top:${CARD.story.footer.gap}px;font-size:${CARD.story.footer.size}px;line-height:40px}
.frow .via{flex:none;width:${CARD.story.footer.via}px}
.frow .site{flex:none;margin-left:auto}
.shade{position:absolute;left:0;right:0;top:0;height:420px;background:linear-gradient(180deg,rgba(16,16,18,.8) 0,rgba(16,16,18,.8) 250px,rgba(16,16,18,0) 100%)}
.fade{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(16,16,18,0) 0,rgba(16,16,18,.84) 300px)}
`

/** A cover's lime date chip and coral headline box. Gratis sets its first word much larger than its second line. */
function headline(c: Cover, size: [max: number, floor: number, lines: number]): string {
  const lines = c.headline.length === 2
    ? `<div class="display" data-role="headline" style="font-size:250px;line-height:.9;white-space:nowrap">${esc(c.headline[0])}</div><div class="display" data-role="headline" data-fit-width="84,56,960" style="white-space:nowrap;margin-top:6px">${esc(c.headline[1])}</div>`
    : `<div class="display" data-role="headline" data-fit="${size.join(',')}" data-shrink style="max-width:966px">${esc(c.headline[0])}</div>`
  return `<span class="chip" data-role="kicker">${esc(c.kicker)}</span><div class="hbox">${lines}</div>`
}

interface Layout { kind: 'carousel' | 'story'; height: number; logo: string }

const SIZES = { top: 28, kicker: 40, title: '60,46,2', tile: [84, 44], desc: 36, venue: 42, barrio: 40, pill: 40, whereBottom: 1256 } as const

const pricePill = (event: PostEvent, size: number) =>
  event.price ? `<span class="pill${event.price === 'Gratis' ? ' free' : ''}" data-role="pill" style="font-size:${size}px;padding:8px 22px">${esc(event.price)}</span>` : ''

/**
 * A story frame's footer: "@handle" or "Vía @handle" on the left and the site's address on the right. The handle is its
 * own element, no wider than the mention pill's area, so the pill can cover it and nothing else.
 */
function storyFooter(event: PostEvent): string {
  const { size, floor } = CARD.story.footer
  const area = mentionArea(event.via)
  // No wider than the widest pill, so the pill always covers the whole printed handle.
  const width = area.right - MENTION_SLACK - (area.aim.left + 14)
  const handle = event.handle
    ? `${event.via ? '<span class="via" data-via>Vía</span>' : ''}<span class="one" data-handle data-fit-width="${size},${floor},${width}" style="max-width:${width}px">@${esc(event.handle)}</span>`
    : ''
  return `<div class="frow" data-role="foot">${handle}<span class="site" data-site>${SITE}</span></div>`
}

/**
 * A story's event frame: the flyer's blur fills the frame, the flyer takes the space between the logo row and the panel,
 * and the panel holds every word on a solid ground. The link sticker's band and everything under it show the blur.
 */
function storyCard(format: FormatKey, layout: Layout, event: PostEvent, index: number, total: number, artwork: Artwork): string {
  const { seam } = CARD.story
  const top = STORY_SAFE.top + 8
  const gap = 20
  // Below the logo and the counter at full width, or between them at full height (a tall flyer is larger there).
  const boxes: Box[] = [{ x: 40, y: top + 48 + 18, w: 1000, h: seam - gap - (top + 48 + 18) }, { x: 310, y: top, w: 460, h: seam - gap - top }]
  const id = `c${index + 1}`
  return `<div class="s" data-frame="card" style="height:${layout.height}px">
${flyerZone(id, event, artwork[event.id], layout.height, boxes, [84, 44], { panel: `${id}-panel`, gap })}
${logoImg(layout.logo, 72, top, 48)}
<div class="count" data-role="counter" style="top:${top}px">${index + 1}/${total}</div>
<div id="${id}-panel" class="spanel">
<div class="kicker" data-role="kicker" style="font-size:48px">${esc(cardKicker(format, event))}</div>
<div class="display title" data-role="title" data-fit="66,48,2">${esc(event.title)}</div>
${event.description ? `<div class="desc clamp" data-role="desc" style="font-size:38px">${esc(event.description)}</div>` : ''}
<div class="venue one" data-role="venue" data-fit-width="46,34">${esc(event.venue)}</div>
<div class="meta" style="min-height:62px"><span class="barrio one" data-role="barrio" style="font-size:40px">${esc(event.barrio)}</span>${pricePill(event, 40)}</div>
${storyFooter(event)}
</div>
</div>`
}

/** A carousel's event card: the flyer above the seam, and below it a solid panel, so the words never depend on the flyer's colors. */
function card(format: FormatKey, layout: Layout, event: PostEvent, index: number, total: number, artwork: Artwork): string {
  if (layout.kind === 'story') return storyCard(format, layout, event, index, total, artwork)
  const { seam, footer } = CARD.carousel
  const size = SIZES
  const under = size.top + 48 + 18
  // Below the logo and the counter at full width, or between them at full height (a tall flyer is larger there).
  const boxes = [{ x: 40, y: under, w: 1000, h: seam - 18 - under }, { x: 348, y: size.top, w: 384, h: seam - 18 - size.top }]
  const handle = footerHandle(event)
  const pill = pricePill(event, size.pill)
  const foot = handle
    ? `<div class="foot" data-role="foot" style="top:${footer.centerY - 20}px;font-size:${footer.size}px;line-height:40px"><span>${esc(handle)}</span></div>`
    : ''
  return `<div class="s" data-frame="card" style="height:${layout.height}px">
${flyerZone(`c${index + 1}`, event, artwork[event.id], seam, boxes, [size.tile[0], size.tile[1]])}
${logoImg(layout.logo, 72, size.top, 48)}
<div class="count" data-role="counter" style="top:${size.top}px">${index + 1}/${total}</div>
<div class="panel" style="top:${seam}px">
<div class="kicker" data-role="kicker" style="font-size:${size.kicker}px">${esc(cardKicker(format, event))}</div>
<div class="display title" data-role="title" data-fit="${size.title}">${esc(event.title)}</div>
${event.description ? `<div class="desc clamp" data-role="desc" style="font-size:${size.desc}px">${esc(event.description)}</div>` : ''}
</div>
<div class="where" style="bottom:${layout.height - size.whereBottom}px">
<div class="venue one" data-role="venue" data-fit-width="${size.venue},34,920">${esc(event.venue)}</div>
<div class="meta" style="min-height:${size.pill + 22}px"><span class="barrio one" data-role="barrio" style="font-size:${size.barrio}px">${esc(event.barrio)}</span>${pill}</div>
</div>
${foot}
</div>`
}

/** Carousel slides (1080 × 1350): a cover with three tilted prints, one card per event, and a closing slide. */
function carouselFrames(format: 'finde' | 'gratis', c: Cover, events: PostEvent[], artwork: Artwork, layout: Layout): string {
  const arts = artOf(events, artwork)
  const logo = logoImg(layout.logo, 72, 48, 56)
  const coverHtml = `<div class="s" data-frame="cover" style="height:${layout.height}px">
${collage(arts, { x: 70, y: 160, w: 940, h: 560 }, 0.46)}
${logo}
<div class="stack" style="bottom:118px">${headline(c, [132, 88, 3])}</div>
<div data-role="swipe" style="position:absolute;right:72px;bottom:40px;font-size:40px;font-weight:600;line-height:1.2">${withArrow(c.footer!)}</div>
</div>`
  const closing = `<div class="s" data-frame="closing" style="height:${layout.height}px">
${mosaic(arts, 1080, layout.height)}
${logo}
<div style="position:absolute;left:80px;right:80px;top:300px">
<div class="display" data-role="headline" data-fit-width="132,96,920" style="line-height:1;white-space:nowrap">${esc(CLOSING.headline)}</div>
<div data-role="body" style="font-size:46px;line-height:1.3;margin-top:36px">${esc(CLOSING.body[format])}</div>
<div data-role="lead" style="font-size:40px;line-height:1.3;margin-top:84px">${esc(CLOSING.lead)}</div>
<div style="margin-top:24px"><span class="btn" data-role="button" style="font-size:52px;padding:26px 44px">${esc(CLOSING.button)}</span></div>
</div>
<div class="foot" data-role="foot" style="bottom:56px;font-size:36px;line-height:1.2;color:${PAPER}"><span>${esc(CLOSING.footer)}</span></div>
</div>`
  return coverHtml + events.map((event, index) => card(format, layout, event, index, events.length, artwork)).join('') + closing
}

/** Story frames (1080 × 1920): a cover with tonight's flyers in a grid, one frame per event, and a closing frame. */
function storyFrames(format: FormatKey, c: Cover, events: PostEvent[], artwork: Artwork, layout: Layout): string {
  const arts = artOf(events, artwork)
  const logo = logoImg(layout.logo, 72, STORY_SAFE.top + 8, 56)
  const site = (text: string) => `<div class="foot" data-role="foot" style="top:${STICKER_BAND.cover[1]}px;font-size:40px;font-weight:600;line-height:1.2;color:${PAPER}"><span>${esc(text)}</span></div>`
  // Tonight's flyers fill the frame: the grid on top, then a row of them again that darkens behind the headline box and
  // on down, so the footer reads and the link sticker sits on flyers, not on a flat ground.
  const coverHtml = `<div class="s" data-frame="cover" style="height:${layout.height}px">
${grid(arts, { x: 0, y: 0, w: 1080, h: 1240 })}
${grid([...arts].reverse().slice(0, 2), { x: 0, y: 1246, w: 1080, h: layout.height - 1246 })}
<div class="fade" style="top:1000px"></div>
<div class="shade"></div>
${logo}
<div class="stack" style="bottom:${layout.height - (STICKER_Y.cover - 104)}px">${headline(c, [136, 88, 2])}</div>
${site(c.footer!)}
</div>`
  const closing = `<div class="s" data-frame="closing" style="height:${layout.height}px">
${mosaic(arts, 1080, layout.height)}
${logo}
<div style="position:absolute;left:80px;right:80px;top:520px">
<div class="display" data-role="headline" data-fit="128,96,2" style="line-height:1;text-wrap:balance">${esc(HOY_CLOSING.headline)}</div>
<div data-role="body" style="font-size:48px;line-height:1.35;margin-top:40px">${esc(HOY_CLOSING.body)}</div>
</div>
${site(HOY_CLOSING.footer)}
</div>`
  return coverHtml + events.map((event, index) => card(format, layout, event, index, events.length, artwork)).join('') + closing
}

/** `artwork` holds the flyers already downloaded for this render (artwork.ts); an event without one gets the no-flyer card. */
export function framesHtml(format: FormatKey, window: RunWindow, events: PostEvent[], assets: Assets, artwork: Artwork = {}): string {
  const kind = FORMATS[format].kind
  if (kind === 'reel') throw new Error('The Reel has no still frames; see reel/project.ts')
  const layout: Layout = { kind, height: FRAME[kind].height, logo: assets.logo }
  const c = cover(format, window, events.length)
  const body = kind === 'story' ? storyFrames(format, c, events, artwork, layout) : carouselFrames(format as 'finde' | 'gratis', c, events, artwork, layout)
  // The renderer waits for data-ready and fails on anything but "ok", so a missing font never renders in a fallback face.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(assets.fontsDir)}${CSS}${LOOK_CSS}</style></head><body>${body}<script>
(function () {${FIT_JS}
  var done = function (error) { document.documentElement.dataset.ready = error ? String(error.message || error) : "ok"; };
  fontsLoaded(document.body).then(function () { layout(document); done(); }).catch(done);
})();
</script></body></html>`
}
