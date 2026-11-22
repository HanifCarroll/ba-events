/**
 * The Este finde Reel as a HyperFrames 0.9.66 project, in the website's look (look.ts). Pure: it returns the files;
 * `runtime.ts` writes them next to the assets, the flyers, and the music and renders them.
 *
 * Timing: every card holds still for H = max(3.0 s, 0.35 s × W, C / 17) after its 0.5 s entrance and before its 0.2 s
 * exit, rounded up to a whole beat of the track, so every cut lands on a beat. Titles are fitted in the page after the
 * fonts load and before the timeline is built, and the flyer is sized into the space the words leave. During the hold
 * only the flyer moves (a slow 4% zoom); the text is still.
 */
import type { Artwork } from '../artwork.ts'
import { REEL_CLOSING, cardKicker, cover } from '../copy.ts'
import type { RunWindow } from '../formats.ts'
import { CORAL, FIT_JS, INK, LIME, LOOK_CSS, PAPER, SOFT, artOf, backdrop, collage, esc, flyerZone, fontFaces, logoImg, mosaic } from '../look.ts'
import type { PostEvent } from '../select.ts'

export const FPS = 30
/** A card prints this to the browser console when it can't be laid out (a font file didn't load). */
export const REEL_FAILURE = 'BA_REEL_CARD_FAILED'
export const REEL_SIZE = { width: 1080, height: 1920 } as const
const ENTER = 0.5
const EXIT = 0.2

/** Seconds rounded to a whole frame, then to the millisecond. */
const fr = (t: number) => Math.round(Math.round(t * FPS) / FPS * 1000) / 1000
const r3 = (x: number) => Math.round(x * 1000) / 1000

export interface CardTiming { id: string; W: number; C: number; H: number; beats: number; start: number; end: number; length: number; holdMid: number }
export interface ReelTiming { bpm: number; total: number; cards: CardTiming[] }

/** W counts words and numbers ("·" and "—" are not words), C counts characters with the texts joined by spaces. */
export function holdFor(texts: string[], beat: number) {
  const s = texts.join(' ')
  const W = s.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length
  const C = s.length
  const H = Math.max(3, 0.35 * W, C / 17)
  const beats = Math.ceil((ENTER + H + EXIT) / beat - 1e-9)
  return { W, C, H, beats }
}

interface Card { id: string; texts: string[]; event?: PostEvent }

function cards(window: RunWindow, events: PostEvent[]): Card[] {
  const c = cover('reel', window, events.length)
  return [
    { id: 'cover', texts: [c.kicker, ...c.headline] },
    ...events.map((event, i) => ({ id: `e${i + 1}`, event, texts: [cardKicker('reel', event), event.title, event.venue, event.barrio, event.price].filter((t): t is string => Boolean(t)) })),
    { id: 'closing', texts: [REEL_CLOSING.headline, REEL_CLOSING.button, REEL_CLOSING.footer] },
  ]
}

export function reelTiming(window: RunWindow, events: PostEvent[], bpm: number): ReelTiming {
  if (events.length < 4 || events.length > 6) throw new Error(`The Reel takes 4 to 6 events, got ${events.length}`)
  if (!(bpm >= 40 && bpm <= 220)) throw new Error(`Implausible BPM ${bpm}`)
  const beat = 60 / bpm
  let at = 0
  const list = cards(window, events).map(card => {
    const hold = holdFor(card.texts, beat)
    const startBeat = at
    at += hold.beats
    return { id: card.id, ...hold, startBeat }
  })
  // Each cut is rounded to a frame once, from its own beat index, so errors never accumulate.
  const cuts = [...list.map(card => fr(card.startBeat * beat)), fr(at * beat)]
  return {
    bpm,
    total: cuts.at(-1)!,
    cards: list.map((card, i) => {
      const length = r3(cuts[i + 1]! - cuts[i]!)
      return { id: card.id, W: card.W, C: card.C, H: r3(card.H), beats: card.beats, start: cuts[i]!, end: cuts[i + 1]!, length, holdMid: r3(cuts[i]! + ENTER + (length - ENTER - EXIT) / 2) }
    }),
  }
}

/**
 * Instagram's Reel chrome covers the right edge and the lower third, so the words stay in x 80–916 and y 226–1330 (the
 * band the approved v3 used). A card's panel is only as tall as its words and ends just under the band; it never
 * starts above SEAM. The flyer takes the space above it, and its blur fills the frame, under and below the panel too.
 */
const BAND = { left: 80, width: 836, top: 226, bottom: 1330 } as const
const SEAM = 960
const PANEL_PAD = 24
const GAP = 26
const ZOOM = 1.04

const CSS = `
${fontFaces('assets/fonts')}
#root{position:absolute;inset:0;overflow:hidden;color:${PAPER};font-family:'DM Sans',sans-serif;background:${INK}}
:where(#root *){box-sizing:border-box;margin:0;padding:0}
${LOOK_CSS}
.bg{position:absolute;inset:0;background:${INK}}
.stage{position:absolute;inset:0}
.out{position:absolute;inset:0}
.panel{position:absolute;left:40px;right:40px;bottom:${1920 - BAND.bottom - PANEL_PAD}px;background:${INK};border-radius:24px;padding:22px 40px ${PANEL_PAD}px}
.panel>div{width:${BAND.width}px}
.text{position:absolute;left:${BAND.left}px;width:${BAND.width}px}
.kicker{color:${LIME};font-size:44px;font-weight:700;line-height:1.1;letter-spacing:.06em;text-transform:uppercase}
.title{line-height:1.06;overflow-wrap:anywhere;margin-top:8px}
.venue-name{font-weight:600;line-height:1.15;margin-top:18px}
.meta{display:flex;align-items:center;gap:24px;margin-top:6px;min-height:62px}
.barrio{color:${SOFT};font-size:42px;line-height:1.2;min-width:0}
.pill{font-size:40px;padding:9px 24px}
.stack{position:absolute;left:${BAND.left - 20}px;width:${BAND.width + 20}px;display:flex;flex-direction:column;align-items:flex-start}
.stack .chip{font-size:44px;padding:12px 20px;margin-bottom:10px}
.stack .hbox{padding:22px 30px 28px}
.btn{font-size:56px;padding:28px 46px}
.link{font-size:44px;font-weight:600;line-height:1.2;margin-top:44px}
.rule{width:120px;height:6px;background:${CORAL}}
`

// In-page helpers: the text is fitted once, after the fonts load, before the timeline is built.
const HELPERS = `${FIT_JS}
  var IN = { opacity: 0, y: 18, filter: "blur(8px)" };
  var LAND = { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.32, ease: "expo.out" };
  var OUT = { opacity: 0, filter: "blur(8px)", duration: ${EXIT}, ease: "power3.in" };`

const scene = (id: string, body: string, script: string) => `<template>
  <style>${CSS}</style>
  <div id="root" data-composition-id="${id}" data-width="1080" data-height="1920">
${body}
  </div>
  <script>
  (function () {${HELPERS}
    var root = document.querySelector('[data-composition-id="${id}"]');
    fontsLoaded(root).then(function () {
      layout(root);
      var tl = gsap.timeline({ paused: true });
${script}
      window.__timelines["${id}"] = tl;
    }).catch(function (error) {
      // Without a timeline the render would wait for this card until it times out. Register an empty one, and say why:
      // runtime.ts fails the render when it sees this line.
      window.__timelines["${id}"] = gsap.timeline({ paused: true });
      console.error("${REEL_FAILURE}: ${id}: " + (error && error.message || error));
    });
  })();
  </script>
</template>
`

const LOGO = logoImg('assets/logo.svg', BAND.left - 8, BAND.top, 56)
/** Smaller on an event card, so the flyer starts sooner under it and a tall flyer fits beside it. */
const CARD_LOGO = logoImg('assets/logo.svg', 64, BAND.top, 44)

/**
 * index.html and compositions/<id>.html. The project also needs assets/ (fonts, the logo, gsap, the flyers `artwork`
 * points at, as paths relative to the project) and assets/music.wav.
 */
export function reelProject(window: RunWindow, events: PostEvent[], timing: ReelTiming, artwork: Artwork = {}): Record<string, string> {
  const files: Record<string, string> = {}
  const dur = (id: string) => timing.cards.find(card => card.id === id)!.length
  const arts = artOf(events, artwork)
  const c = cover('reel', window, events.length)

  { // Cover: on screen from frame 0 with no entrance (the thumbnail). Its words sit inside the profile grid's centre 3:4 crop (y 240–1680).
    const D = dur('cover')
    files['compositions/cover.html'] = scene('cover', `
    <div class="bg"></div>
    <div id="cover-stage" class="stage clip" data-start="0" data-duration="${D}">
      <div id="cover-out" class="out">
        ${backdrop(arts)}
        ${collage(arts, { x: 40, y: 300, w: 1000, h: 650 }, 0.52)}
        ${LOGO}
        <div class="stack" style="bottom:${1920 - BAND.bottom}px" data-hold>
          <span id="cover-kicker" class="chip" data-role="kicker">${esc(c.kicker)}</span>
          <div class="hbox"><div id="cover-title" class="display" data-role="headline" data-fit="124,88,3" data-shrink style="max-width:${BAND.width - 40}px">${esc(c.headline[0])}</div></div>
        </div>
      </div>
    </div>`, `      tl.fromTo("#cover-out", { opacity: 1, filter: "blur(0px)" }, OUT, ${r3(D - EXIT)});`)
  }

  events.forEach((event, i) => {
    const id = `e${i + 1}`
    const D = dur(id)
    const art = artwork[event.id]
    const pill = event.price ? `<span id="${id}-pill" class="pill${event.price === 'Gratis' ? ' free' : ''}" data-role="pill">${esc(event.price)}</span>` : ''
    // Just under the logo at full width, or beside it from higher up (a tall flyer is larger there).
    const boxes = [{ x: 60, y: BAND.top + 58, w: 960, h: SEAM - GAP - BAND.top - 58 }, { x: 284, y: 130, w: 512, h: SEAM - GAP - 130 }]
    files[`compositions/${id}.html`] = scene(id, `
    <div class="bg"></div>
    <div id="${id}-stage" class="stage clip" data-start="0" data-duration="${D}">
      <div id="${id}-out" class="out">
        ${flyerZone(id, event, art, 1920, boxes, [84, 52], { panel: `${id}-panel`, gap: GAP })}
        ${CARD_LOGO}
        <div id="${id}-panel" class="panel" data-hold>
          <div id="${id}-kicker" class="kicker" data-role="kicker">${esc(cardKicker('reel', event))}</div>
          <div id="${id}-title" class="display title" data-role="title" data-fit="68,50,2">${esc(event.title)}</div>
          <div id="${id}-venue" class="venue-name one" data-role="venue" data-fit-width="50,40">${esc(event.venue)}</div>
          <div id="${id}-meta" class="meta"><span id="${id}-barrio" class="barrio one" data-role="barrio">${esc(event.barrio)}</span>${pill}</div>
        </div>
      </div>
    </div>`, `      tl.fromTo("#${id}-zone", { opacity: 0 }, { opacity: 1, duration: 0.32, ease: "power2.out" }, 0);
      tl.fromTo("#${id}-panel", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, 0);${art ? `
      tl.fromTo("#${id}-fly", { scale: 1 }, { scale: ${ZOOM}, duration: ${r3(D)}, ease: "none" }, 0);` : ''}
      tl.fromTo("#${id}-kicker", IN, LAND, 0);
      tl.fromTo("#${id}-title", IN, LAND, 0.06);
      tl.fromTo("#${id}-venue", IN, LAND, 0.12);
      tl.fromTo("#${id}-meta", IN, LAND, 0.18);${pill ? `
      tl.fromTo("#${id}-pill", { scale: 0.85 }, { scale: 1, duration: 0.32, ease: "expo.out" }, 0.18);` : ''}
      tl.fromTo("#${id}-out", { opacity: 1, filter: "blur(0px)" }, OUT, ${r3(D - EXIT)});`)
  })

  { // Closing: the post's flyers, dimmed, behind the last words; holds to the end.
    const D = dur('closing')
    files['compositions/closing.html'] = scene('closing', `
    <div class="bg"></div>
    <div id="closing-mosaic" class="stage">${mosaic(arts, 1080, 1920)}</div>
    <div id="closing-stage" class="stage clip" data-start="0" data-duration="${D}">
      ${LOGO}
      <div class="text" style="bottom:${1920 - BAND.bottom}px" data-hold>
        <div id="closing-rule" class="rule"></div>
        <div id="closing-title" class="display" data-role="headline" data-fit="124,92,2" style="line-height:1.02;margin-top:36px;text-wrap:balance">${esc(REEL_CLOSING.headline)}</div>
        <div id="closing-cta" style="margin-top:56px"><span class="btn" data-role="button">${esc(REEL_CLOSING.button)}</span></div>
        <div id="closing-link" class="link" data-role="foot">${esc(REEL_CLOSING.footer)}</div>
      </div>
    </div>`, `      tl.fromTo("#closing-mosaic", { opacity: 0 }, { opacity: 1, duration: 0.32, ease: "power2.out" }, 0);
      tl.fromTo("#closing-rule", IN, LAND, 0);
      tl.fromTo("#closing-title", IN, LAND, 0.03);
      tl.fromTo("#closing-cta", IN, LAND, 0.1);
      tl.fromTo("#closing-link", IN, LAND, 0.18);`)
  }

  const hosts = timing.cards.map(card => `      <div id="${card.id}" data-composition-id="${card.id}" data-composition-src="compositions/${card.id}.html" data-start="${card.start}" data-duration="${card.length}" data-track-index="1" data-track-kind="graphics" data-width="1080" data-height="1920"></div>`).join('\n')
  files['index.html'] = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: ${INK}; }
      #root { position: relative; width: 1080px; height: 1920px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${timing.total}" data-fps="${FPS}" data-width="1080" data-height="1920">
${hosts}
      <audio id="music" src="assets/music.wav" data-start="0" data-duration="${timing.total}" data-track-index="2" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`
  files['hyperframes.json'] = `${JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true } }, null, 2)}\n`
  files['meta.json'] = `${JSON.stringify({ id: 'reel', name: 'reel' })}\n`
  return files
}
