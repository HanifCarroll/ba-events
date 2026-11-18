/**
 * The Este finde Reel as a HyperFrames 0.9.66 project, ported from the approved v3 generator (build.mjs). Pure: it
 * returns the files; `runtime.ts` writes them next to the assets and the music and renders them.
 *
 * Timing: every card holds still for H = max(3.0 s, 0.35 s × W, C / 17) after its 0.5 s entrance and before its 0.2 s
 * exit, rounded up to a whole beat of the track, so every cut lands on a beat. Titles are fitted in the page after the
 * fonts load and before the timeline is built.
 */
import { CLOSING, REEL, cardKicker } from '../copy.ts'
import { dateRange } from '../format.ts'
import type { RunWindow } from '../formats.ts'
import type { PostEvent } from '../select.ts'

export const FPS = 30
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
  return [
    { id: 'cover', texts: [REEL.brand, dateRange(window.from, window.to), ...REEL.headline] },
    ...events.map((event, i) => ({ id: `e${i + 1}`, event, texts: [cardKicker('finde', event), event.title, event.venue, event.barrio, event.price].filter((t): t is string => Boolean(t)) })),
    { id: 'closing', texts: [REEL.brand, CLOSING.headline, CLOSING.button, CLOSING.footer] },
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

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// The approved v3 look. Photo cards (cover, closing): a light overall shade keeps the skyline visible; the text sits
// low in the safe band over the darker rooftop crowd, with a feathered scrim behind it dark enough for 7:1.
const SHADE_TOP = 0.45, SHADE_MID = 0.35, SCRIM = 0.65, FEATHER = 240, PAD = 40, LOW_BOTTOM = 1310
const RANGE = 'unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const RANGE_EXT = 'unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
// Newsreader 400 at a fixed opsz 16: the lightest setting whose hairlines stay >= 3 px at the 72 px floor after encoding.
const CSS = `
@font-face{font-family:'Newsreader';font-style:normal;font-weight:200 800;src:url('assets/fonts/newsreader-latin-opsz-normal.woff2') format('woff2');${RANGE}}
@font-face{font-family:'Newsreader';font-style:normal;font-weight:200 800;src:url('assets/fonts/newsreader-latin-ext-opsz-normal.woff2') format('woff2');${RANGE_EXT}}
@font-face{font-family:'DM Sans';font-style:normal;font-weight:100 1000;src:url('assets/fonts/dm-sans-latin-wght-normal.woff2') format('woff2');${RANGE}}
@font-face{font-family:'DM Sans';font-style:normal;font-weight:100 1000;src:url('assets/fonts/dm-sans-latin-ext-wght-normal.woff2') format('woff2');${RANGE_EXT}}
#root{position:absolute;inset:0;overflow:hidden;color:#fff;font-family:'DM Sans',sans-serif}
:where(#root *){box-sizing:border-box;margin:0;padding:0}
.bg{position:absolute;inset:0;background:#0d1330}
.card{background:radial-gradient(1500px 1300px at 85% 0%,#26307a 0%,#0d1330 60%)}
.grain{position:absolute;inset:0;background:url('assets/noise.png');opacity:.1;mix-blend-mode:overlay}
.photo{position:absolute;inset:0;background:url('assets/hero-rooftop-buenos-aires.jpg') center/cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,15,40,${SHADE_TOP}) 0%,rgba(10,15,40,${SHADE_MID}) 30%,rgba(10,15,40,${SHADE_MID}) 50%,rgba(10,15,40,.80) 75%,rgba(10,15,40,.90) 100%)}
.scrim{position:absolute;left:0;right:0;top:0;height:0;background:linear-gradient(180deg,rgba(10,15,40,0) 0,rgba(10,15,40,${SCRIM}) ${FEATHER}px,rgba(10,15,40,${SCRIM}) calc(100% - ${FEATHER}px),rgba(10,15,40,0) 100%)}
.band.low{justify-content:flex-end;height:${LOW_BOTTOM - 300}px}
.serif{font-family:'Newsreader',Georgia,serif;font-weight:400;font-optical-sizing:none;font-variation-settings:'opsz' 16}
.brand{position:absolute;top:226px;left:80px;font-weight:600;font-size:40px;line-height:1.2;letter-spacing:-.3px}
.stage{position:absolute;inset:0}
.out{position:absolute;inset:0}
.band{position:absolute;left:80px;width:836px;top:300px;height:1030px;display:flex;flex-direction:column;justify-content:center}
.kicker{font-size:44px;line-height:1.2;letter-spacing:.08em;text-transform:uppercase;color:#c3caff;font-weight:600}
.title{font-size:112px;line-height:1.06;letter-spacing:-1px;margin-top:28px}
.venue{border-top:2px solid rgba(255,255,255,.3);padding-top:40px;margin-top:56px}
.venue-name{font-size:56px;line-height:1.15;font-weight:600}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:16px 24px;margin-top:20px;font-size:44px;line-height:1.2;color:rgba(255,255,255,.92)}
.pill{display:inline-block;border:2px solid rgba(255,255,255,.6);border-radius:999px;padding:8px 26px;font-size:40px;line-height:1.2;color:#fff}
.pill.free{border:0;background:#2fbf71;color:#03140a;padding:10px 28px;font-weight:600}
.btn{display:inline-block;background:#4848b8;border-radius:20px;padding:26px 44px;font-size:48px;line-height:1.2;font-weight:600}
.link{font-size:40px;line-height:1.2;margin-top:48px}
`

// In-page helpers: fitted once from the text, after the fonts load, before the timeline is built.
const HELPERS = `
  var IN = { opacity: 0, y: 18, filter: "blur(8px)" };
  var LAND = { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.32, ease: "expo.out" };
  var OUT = { opacity: 0, filter: "blur(8px)", duration: ${EXIT}, ease: "power3.in" };
  function measurer(el, width) {
    var cs = getComputedStyle(el), m = document.createElement("div");
    m.innerHTML = el.innerHTML;
    m.style.cssText = "position:absolute;left:-5000px;top:0;visibility:hidden;" + (width ? "width:" + width + "px;" : "white-space:nowrap;") +
      "font-family:" + cs.fontFamily + ";font-weight:" + cs.fontWeight + ";letter-spacing:" + cs.letterSpacing +
      ";font-optical-sizing:" + cs.fontOpticalSizing + ";font-variation-settings:" + cs.fontVariationSettings;
    document.body.appendChild(m);
    return m;
  }
  function fitLines(el, max, floor, step, lh, maxLines, width) {
    var m = measurer(el, width), size = max, lines = 0;
    for (; size >= floor; size -= step) {
      m.style.fontSize = size + "px"; m.style.lineHeight = lh;
      lines = Math.round(m.getBoundingClientRect().height / (size * lh));
      if (lines <= maxLines) break;
    }
    if (size < floor) { size = floor; console.warn("text still over " + maxLines + " lines at floor: " + el.id); }
    m.remove();
    el.style.fontSize = size + "px"; el.dataset.fitSize = size; el.dataset.fitLines = lines;
  }
  function fitWidth(el, max, floor, step, width) {
    var m = measurer(el, 0), size = max;
    for (; size > floor; size -= step) { m.style.fontSize = size + "px"; if (m.getBoundingClientRect().width <= width) break; }
    m.remove();
    el.style.fontSize = size + "px"; el.dataset.fitSize = size;
  }
  function placeScrim(scrim, first, last) {
    var top = first.getBoundingClientRect().top - ${PAD} - ${FEATHER}, bottom = last.getBoundingClientRect().bottom + ${PAD} + ${FEATHER};
    scrim.style.top = Math.round(top) + "px"; scrim.style.height = Math.round(bottom - top) + "px";
  }
  function fontsFor(els) {
    return Promise.all(els.map(function (el) {
      var cs = getComputedStyle(el);
      return document.fonts.load(cs.fontWeight + " 40px " + cs.fontFamily, el.textContent);
    }));
  }`

const scene = (id: string, body: string, script: string) => `<template>
  <style>${CSS}</style>
  <div id="root" data-composition-id="${id}" data-width="1080" data-height="1920">
${body}
  </div>
  <script>
  (function () {${HELPERS}
${script}
  })();
  </script>
</template>
`

/** index.html and compositions/<id>.html. The project also needs assets/ (fonts, photo, noise, gsap) and assets/music.wav. */
export function reelProject(window: RunWindow, events: PostEvent[], timing: ReelTiming): Record<string, string> {
  const files: Record<string, string> = {}
  const dur = (id: string) => timing.cards.find(card => card.id === id)!.length
  const range = dateRange(window.from, window.to)
  const [h1, h2] = REEL.headline

  { // Cover: on screen from frame 0 (the thumbnail), static photo under the shade and a local scrim; floods to the card ground.
    const D = dur('cover')
    files['compositions/cover.html'] = scene('cover', `
    <div class="photo"></div>
    <div class="shade"></div>
    <div id="cover-scrim" class="scrim"></div>
    <div class="grain"></div>
    <div id="cover-brand" class="brand tx">${esc(REEL.brand)}</div>
    <div id="cover-stage" class="stage clip" data-start="0" data-duration="${D}">
      <div id="cover-out" class="out">
        <div class="band low" data-hold>
          <div id="cover-kicker" class="kicker tx">${esc(range)}</div>
          <div id="cover-title" class="serif tx" style="font-size:140px;line-height:1;letter-spacing:-2px;margin-top:32px"><span style="white-space:nowrap">${esc(h1)}</span><br><span style="white-space:nowrap">${esc(h2)}</span></div>
        </div>
      </div>
    </div>
    <div id="cover-flood" class="bg card" style="opacity:0"></div>`, `
    var title = document.getElementById("cover-title");
    fontsFor([title, document.getElementById("cover-kicker")]).then(function () {
      fitWidth(title, 140, 112, 2, 836);
      placeScrim(document.getElementById("cover-scrim"), document.getElementById("cover-kicker"), title);
      var tl = gsap.timeline({ paused: true });
      tl.fromTo("#cover-out", { opacity: 1, filter: "blur(0px)" }, OUT, ${r3(D - EXIT)});
      tl.fromTo("#cover-flood", { opacity: 0 }, { opacity: 1, duration: ${EXIT}, ease: "power2.inOut" }, ${r3(D - EXIT)});
      window.__timelines["cover"] = tl;
    });`)
  }

  events.forEach((event, i) => {
    const id = `e${i + 1}`
    const D = dur(id)
    const pill = event.price ? `<span id="${id}-pill" class="pill${event.price === 'Gratis' ? ' free' : ''} tx">${esc(event.price)}</span>` : ''
    files[`compositions/${id}.html`] = scene(id, `
    <div class="bg card"></div>
    <div class="grain"></div>
    <div id="${id}-brand" class="brand tx">${esc(REEL.brand)}</div>
    <div id="${id}-stage" class="stage clip" data-start="0" data-duration="${D}">
      <div id="${id}-out" class="out">
        <div class="band" data-hold>
          <div id="${id}-kicker" class="kicker tx">${esc(cardKicker('finde', event))}</div>
          <div id="${id}-title" class="serif title tx">${esc(event.title)}</div>
          <div id="${id}-venue" class="venue">
            <div id="${id}-venue-name" class="venue-name tx">${esc(event.venue)}</div>
          </div>
          <div id="${id}-meta" class="meta"><span id="${id}-barrio" class="tx">${esc(event.barrio)}</span>${pill}</div>
        </div>
      </div>
    </div>`, `
    var title = document.getElementById("${id}-title");
    fontsFor([title, document.getElementById("${id}-kicker"), document.getElementById("${id}-venue-name")]).then(function () {
      fitLines(title, 112, 72, 4, 1.06, 3, 836);
      var tl = gsap.timeline({ paused: true });
      tl.fromTo("#${id}-kicker", IN, LAND, 0);
      tl.fromTo("#${id}-title", IN, LAND, 0.06);
      tl.fromTo("#${id}-venue", IN, LAND, 0.12);
      tl.fromTo("#${id}-meta", IN, LAND, 0.18);${pill ? `
      tl.fromTo("#${id}-pill", { scale: 0.85 }, { scale: 1, duration: 0.32, ease: "expo.out" }, 0.18);` : ''}
      tl.fromTo("#${id}-out", { opacity: 1, filter: "blur(0px)" }, OUT, ${r3(D - EXIT)});
      window.__timelines["${id}"] = tl;
    });`)
  })

  { // Closing: the photo fades back in under the same shade and scrim as the cover; holds to the end.
    const D = dur('closing')
    files['compositions/closing.html'] = scene('closing', `
    <div class="bg card"></div>
    <div id="closing-photo" class="stage"><div class="photo"></div><div class="shade"></div><div id="closing-scrim" class="scrim"></div></div>
    <div class="grain"></div>
    <div id="closing-brand" class="brand tx">${esc(REEL.brand)}</div>
    <div id="closing-stage" class="stage clip" data-start="0" data-duration="${D}">
      <div class="band low" data-hold>
        <div id="closing-title" class="serif tx" style="font-size:120px;line-height:1.06;letter-spacing:-1px">${esc(CLOSING.headline)}</div>
        <div id="closing-cta" style="margin-top:64px"><span class="btn tx">${esc(CLOSING.button)}</span></div>
        <div id="closing-link" class="link tx">${esc(CLOSING.footer)}</div>
      </div>
    </div>`, `
    var title = document.getElementById("closing-title");
    fontsFor([title, document.getElementById("closing-cta")]).then(function () {
      fitLines(title, 120, 80, 4, 1.06, 2, 836);
      placeScrim(document.getElementById("closing-scrim"), title, document.getElementById("closing-link"));
      var tl = gsap.timeline({ paused: true });
      tl.fromTo("#closing-photo", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.inOut" }, 0);
      tl.fromTo("#closing-title", IN, LAND, 0);
      tl.fromTo("#closing-cta", IN, LAND, 0.09);
      tl.fromTo("#closing-link", IN, LAND, 0.18);
      window.__timelines["closing"] = tl;
    });`)
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
      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #0d1330; }
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
