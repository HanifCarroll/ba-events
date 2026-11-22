/**
 * The website's look, shared by the still frames (html.ts) and the Reel (reel/project.ts): its colors, its two type
 * families, the flyer on its own blurred backdrop, and the in-page text fitting. Pure: no file is read here.
 */
import type { Art, Artwork } from './artwork.ts'
import type { PostEvent } from './select.ts'

/** baeventos.com's page ground, the logo's coral and paper, and the lime of its filter pills. */
export const INK = '#101012'
export const TILE = '#1d1d23'
export const LINE = '#3b3b42'
export const CORAL = '#e8484a'
export const PAPER = '#fbf3e6'
export const LIME = '#d0ff36'
export const LIME_INK = '#171a0c'
export const SOFT = '#d5d5db'

export const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

/** The site's faces, Newsreader for headlines and DM Sans for the rest, from the vendored woff2 files in `dir`. */
export const fontFaces = (dir: string) => ([
  ['Newsreader', 'newsreader-latin-opsz-normal.woff2', LATIN, '200 800'],
  ['Newsreader', 'newsreader-latin-ext-opsz-normal.woff2', LATIN_EXT, '200 800'],
  ['DM Sans', 'dm-sans-latin-wght-normal.woff2', LATIN, '100 1000'],
  ['DM Sans', 'dm-sans-latin-ext-wght-normal.woff2', LATIN_EXT, '100 1000'],
] as const).map(([family, file, range, weight]) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url('${dir}/${file}') format('woff2');unicode-range:${range}}`).join('\n')

/** The classes both renderers use. Sizes and positions are set per format. */
export const LOOK_CSS = `
.display{font-family:'Newsreader',Georgia,serif;font-weight:600;letter-spacing:-.015em}
.zone{position:absolute;left:0;top:0;width:1080px;overflow:hidden;background:${TILE}}
.fill{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block}
.fly{position:absolute;display:block;box-shadow:0 18px 48px rgba(0,0,0,.55)}
.tile{position:absolute;display:flex;flex-direction:column;justify-content:center;background:${INK};border:2px solid ${LINE};color:${PAPER}}
.tile i{display:block;flex:none;width:120px;height:6px;background:${CORAL}}
.tile div{line-height:1.05;overflow-wrap:anywhere}
.frame{position:absolute;overflow:hidden;background:${TILE}}
.tilt{border:6px solid ${PAPER};border-radius:6px;box-shadow:0 16px 40px rgba(0,0,0,.5)}
.tilt[data-tilt='-6']{transform:rotate(-6deg)}
.tilt[data-tilt='4']{transform:rotate(4deg)}
.tilt[data-tilt='-3']{transform:rotate(-3deg)}
.dim{position:absolute;inset:0;background:rgba(16,16,18,.84)}
.logo{position:absolute;display:block}
.chip{display:inline-block;background:${LIME};color:${LIME_INK};font-weight:700;line-height:1;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.hbox{display:inline-block;background:${CORAL};color:${PAPER}}
.hbox div{line-height:1;text-wrap:balance}
.pill{display:inline-block;flex:none;border:3px solid ${PAPER};border-radius:999px;color:${PAPER};font-weight:600;line-height:1;white-space:nowrap}
.pill.free{border-color:${LIME};background:${LIME};color:${LIME_INK};font-weight:700}
.btn{display:inline-block;background:${CORAL};color:${PAPER};font-weight:700;line-height:1;border-radius:20px}
.clamp{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
.one{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`

/**
 * In-page fitting, run once after the fonts load. `data-fit="max,floor,lines[,last]"` steps the font size down until the
 * text takes at most `lines` lines and no word overflows its box; at the floor it allows `last` lines when given, then cuts the rest with an ellipsis.
 * `data-fit-width="max,floor,width"` does the same for one line that must fit `width` px. `fontsLoaded` rejects when a
 * vendored font file is missing, because the renderer would otherwise fall back to a system face without a word.
 */
export const FIT_JS = `
  function fitText(root) {
    root.querySelectorAll("[data-fit]").forEach(function (el) {
      var p = el.dataset.fit.split(",").map(Number), size = p[0], lines = 0;
      var count = function () { return Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)); };
      // Words stay whole while fitting; only a word still wider than the box at the floor is broken.
      el.style.overflowWrap = "normal";
      for (;; size = Math.max(p[1], size - 2)) {
        el.style.fontSize = size + "px"; lines = count();
        if ((lines <= p[2] && el.scrollWidth <= el.clientWidth) || size <= p[1]) break;
      }
      el.style.overflowWrap = ""; lines = count();
      var most = p[3] || p[2];
      if (lines > most) { el.classList.add("clamp"); el.style.webkitLineClamp = most; lines = most; }
      el.dataset.fitSize = size; el.dataset.fitLines = lines;
    });
    root.querySelectorAll("[data-fit-width]").forEach(function (el) {
      var p = el.dataset.fitWidth.split(",").map(Number), size = p[0];
      for (;; size = Math.max(p[1], size - 2)) {
        el.style.fontSize = size + "px";
        if (el.scrollWidth <= p[2] || size <= p[1]) break;
      }
      el.dataset.fitSize = size;
    });
    // A box around balanced lines is as wide as its widest line, not as wide as the space it was given.
    root.querySelectorAll("[data-shrink]").forEach(function (el) {
      var range = document.createRange(); range.selectNodeContents(el);
      el.style.width = Math.ceil(range.getBoundingClientRect().width) + 2 + "px";
    });
  }
  function fontsLoaded(root) {
    var text = root.textContent;
    return Promise.all(["600 40px Newsreader", "400 40px 'DM Sans'", "600 40px 'DM Sans'", "700 40px 'DM Sans'"].map(function (font) {
      return document.fonts.load(font, text);
    })).then(function (loaded) {
      if (loaded.some(function (faces) { return !faces.length; })) throw new Error("A font file did not load");
    });
  }`

export interface Box { x: number; y: number; w: number; h: number }

/** The largest box of the given proportions that fits inside `box`, centred. */
export function contain(width: number, height: number, box: Box): Box {
  const scale = Math.min(box.w / width, box.h / height)
  const [w, h] = [Math.round(width * scale), Math.round(height * scale)]
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h }
}

const place = ({ x, y, w, h }: Box) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`

/** The events' artwork, in post order. */
export const artOf = (events: PostEvent[], artwork: Artwork): Art[] => events.flatMap(event => artwork[event.id] ?? [])

/**
 * The top of an event card: the event's own flyer, whole, over a blurred, darkened copy of itself. The flyer takes
 * whichever of `boxes` shows it largest (one runs beside the logo, one below it). An event with no usable artwork gets
 * a dark 4:5 tile with a coral rule and its title, so the card still reads as designed.
 */
export function flyerZone(id: string, event: PostEvent, art: Art | undefined, seam: number, boxes: Box[], tileTitle: [max: number, floor: number]): string {
  const largest = (width: number, height: number) => boxes.map(box => contain(width, height, box)).sort((a, b) => b.w * b.h - a.w * a.h)[0]!
  if (art) {
    return `<div id="${id}-zone" class="zone" style="height:${seam}px"><img class="fill" src="${esc(art.backdrop)}" alt=""><img id="${id}-fly" class="fly" data-flyer src="${esc(art.file)}" alt="" style="${place(largest(art.width, art.height))}"></div>`
  }
  const tile = largest(4, 5)
  const pad = Math.round(tile.w * 0.1)
  return `<div id="${id}-zone" class="zone" style="height:${seam}px"><div class="tile" data-fallback style="${place(tile)};padding:${pad}px"><i></i><div class="display" data-role="tile-title" data-fit="${tileTitle.join(',')},4,6" style="margin-top:${Math.round(pad * 0.6)}px">${esc(event.title)}</div></div></div>`
}

/**
 * A flyer in a frame of other proportions: cropped to fill it, as the site's header crops them, unless that would hide
 * more than 30% of the flyer; then it is shown whole over its own blur.
 */
function framed(art: Art, box: Box, extra = ''): string {
  const [flyer, frame] = [art.width / art.height, box.w / box.h]
  if (Math.min(flyer / frame, frame / flyer) >= 0.7) return `<div class="frame${extra}" style="${place(box)}"><img class="fill" src="${esc(art.file)}" alt=""></div>`
  return `<div class="frame${extra}" style="${place(box)}"><img class="fill" src="${esc(art.backdrop)}" alt=""><img src="${esc(art.file)}" alt="" style="position:absolute;display:block;${place(contain(art.width, art.height, { x: 0, y: 0, w: box.w, h: box.h }))}"></div>`
}

const TILTS = [-6, 4, -3]
const DROPS = [14, 2, 18]

/** Up to three 4:5 prints, tilted and overlapping across `box`, as in the site's header. Each is `share` of the box wide. */
export function collage(arts: Art[], box: Box, share = 0.5): string {
  const shown = arts.slice(0, 3)
  const width = Math.round(box.w * share)
  const height = Math.round(width * 1.25)
  const spread = shown.length === 2 ? [0.12, 0.88] : shown.length === 1 ? [0.5] : [0, 0.5, 1]
  return shown.map((art, i) => framed(art, {
    x: Math.round(box.x + (box.w - width) * spread[i]!), y: Math.round(box.y + (box.h - height) / 2 + DROPS[i]! - 11), w: width, h: height,
  }, ` tilt" data-tilt="${TILTS[i]}`)).join('')
}

/** Up to four flyers filling `box`: two by two, two over one wide, two side by side, or one. */
export function grid(arts: Art[], box: Box, gap = 6): string {
  const shown = arts.slice(0, 4)
  const rows = shown.length > 2 ? 2 : 1
  const h = Math.round((box.h - gap * (rows - 1)) / rows)
  const half = Math.round((box.w - gap) / 2)
  return shown.map((art, i) => {
    const wide = shown.length === 1 || (shown.length === 3 && i === 2)
    const row = shown.length > 2 && i >= 2 ? 1 : 0
    const col = wide ? 0 : i % 2
    return framed(art, { x: box.x + col * (half + gap), y: box.y + row * (h + gap), w: wide ? box.w : half, h })
  }).join('')
}

/** A closing frame's ground: the post's flyers tiled three across, repeated to fill, under a dark wash. */
export function mosaic(arts: Art[], width: number, height: number): string {
  if (!arts.length) return ''
  const cols = 3
  const rows = Math.round(height / (width / cols * 1.3))
  const [w, h] = [width / cols, height / rows]
  const shift = arts.length % cols === 0 ? 1 : 0
  const cells = Array.from({ length: rows * cols }, (_, k) => {
    const [row, col] = [Math.floor(k / cols), k % cols]
    const art = arts[(k + row * shift) % arts.length]!
    return `<img class="fill" src="${esc(art.file)}" alt="" style="${place({ x: Math.round(col * w), y: Math.round(row * h), w: Math.ceil(w), h: Math.ceil(h) })}">`
  }).join('')
  return `${cells}<div class="dim"></div>`
}

export const logoImg = (src: string, left: number, top: number, height: number) =>
  `<img class="logo" src="${esc(src)}" alt="BA Eventos" style="left:${left}px;top:${top}px;height:${height}px;width:${Math.round(height * 900 / 198)}px">`

/** The vendored DM Sans faces don't cover "→" (U+2192 is outside their unicode ranges), so the arrow is drawn; it scales with the text beside it. */
export const ARROW = `<svg data-arrow viewBox="0 0 24 24" style="display:inline-block;height:.78em;width:.78em;vertical-align:-.06em;margin-left:.28em" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="→"><path d="M4 12h16M13 5l7 7-7 7"/></svg>`
