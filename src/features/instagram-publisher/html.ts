/** The frames as one HTML page, in the look of the live weekend carousel (templates ba-p2): one `.s` element per frame. */
import { CLOSING, HOY_CLOSING, cardKicker, cover } from './copy.ts'
import { FORMATS, type FormatKey, type RunWindow } from './formats.ts'
import type { PostEvent } from './select.ts'

export const FRAME = { story: { width: 1080, height: 1920 }, carousel: { width: 1080, height: 1350 } } as const

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Long titles step down in size so they stay within about three lines. */
const titleSize = (title: string) => title.length <= 18 ? 104 : title.length <= 34 ? 88 : title.length <= 60 ? 72 : 60

const pill = (price: string) => price === 'Gratis'
  ? `<span class='pill free'>Gratis</span>`
  : `<span class='pill'>${escape(price)}</span>`

export interface Assets { fontsDir: string; heroPhoto: string }

export function framesHtml(format: FormatKey, window: RunWindow, events: PostEvent[], assets: Assets): string {
  const story = FORMATS[format].kind === 'story'
  const { height } = story ? FRAME.story : FRAME.carousel
  // A story frame is taller; its content sits lower so Instagram's top bar and reply box don't cover it.
  const top = story ? 1.32 : 1
  const c = cover(format, window, events.length)
  const coverHtml = `<div class='s'><div class='photo'></div><div class='shade'></div>
<div class='brand'>BA Eventos</div>
<div class='block' style='top:${Math.round(380 * top)}px'>
 <div class='kicker'>${escape(c.kicker)}</div>
 <div class='serif' style='font-size:${c.headline.length === 1 ? 112 : 128}px;line-height:.98;letter-spacing:-3px;margin-top:30px'>${c.headline.map(line => `<span style='white-space:nowrap'>${escape(line)}</span>`).join('<br>')}</div>
 <div style='font-size:42px;margin-top:48px;color:rgba(255,255,255,.9)'>${escape(c.body)}</div>
 ${c.english ? `<div style='font-size:30px;margin-top:28px;color:rgba(255,255,255,.65)'>${escape(c.english)}</div>` : ''}
</div>
<div class='foot'><span>baeventos.com</span><span>${story ? '' : 'Deslizá →'}</span></div></div>`
  const cards = events.map((event, index) => `<div class='s card'>
<div class='brand'>BA Eventos</div><div class='counter'>${index + 1}/${events.length}</div>
<div class='block' style='top:${Math.round(300 * top)}px'>
 <div class='kicker'>${escape(cardKicker(format, event))}</div>
 <div class='serif' style='font-size:${titleSize(event.title)}px;line-height:1.02;letter-spacing:-2px;margin-top:34px'>${escape(event.title)}</div>
 ${event.description ? `<div style='font-size:40px;line-height:1.35;margin-top:30px;color:rgba(255,255,255,.85)'>${escape(event.description)}</div>` : ''}
</div>
<div class='venue' style='bottom:${story ? 330 : 200}px'>
 <div style='font-size:44px;font-weight:600'>${escape(event.venue)}</div>
 <div class='meta'><span>${escape(event.barrio)}</span>${event.price ? pill(event.price) : ''}</div>
</div>
<div class='foot'><span>${event.handle ? `@${escape(event.handle)}` : ''}</span><span>baeventos.com</span></div></div>`).join('')
  const closing = story
    ? `<div class='s'><div class='photo'></div><div class='shade' style='background:rgba(10,15,40,.86)'></div>
<div class='brand'>BA Eventos</div>
<div class='block' style='top:${Math.round(380 * top)}px'>
 <div class='serif' style='font-size:112px;line-height:1.02;letter-spacing:-2px'>${escape(HOY_CLOSING.headline)}</div>
 <div style='font-size:40px;line-height:1.4;margin-top:40px;color:rgba(255,255,255,.9)'>${escape(HOY_CLOSING.body)}</div>
</div>
<div class='foot'><span>${escape(HOY_CLOSING.footer)}</span><span></span></div></div>`
    : `<div class='s'><div class='photo'></div><div class='shade' style='background:rgba(10,15,40,.86)'></div>
<div class='brand'>BA Eventos</div>
<div class='block' style='top:380px'>
 <div class='serif' style='font-size:112px;line-height:1.02;letter-spacing:-2px'>${escape(CLOSING.headline)}</div>
 <div style='font-size:40px;line-height:1.4;margin-top:40px;color:rgba(255,255,255,.9)'>${escape(CLOSING.body)}</div>
 <div style='margin-top:60px'><span class='btn'>${escape(CLOSING.button)}</span></div>
</div>
<div class='foot'><span>${escape(CLOSING.footer)}</span><span></span></div></div>`
  const font = (family: string, file: string, range: string, axis: string) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${axis};src:url('${assets.fontsDir}/${file}') format('woff2');unicode-range:${range}}`
  const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
  const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
  return `<!doctype html><html><head><meta charset='utf-8'><style>
${font('Newsreader', 'newsreader-latin-opsz-normal.woff2', LATIN, '200 800')}
${font('Newsreader', 'newsreader-latin-ext-opsz-normal.woff2', LATIN_EXT, '200 800')}
${font('DM Sans', 'dm-sans-latin-wght-normal.woff2', LATIN, '100 1000')}
${font('DM Sans', 'dm-sans-latin-ext-wght-normal.woff2', LATIN_EXT, '100 1000')}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;background:#000}
.s{width:1080px;height:${height}px;position:relative;overflow:hidden;color:#fff;font-family:'DM Sans',sans-serif;background:#0d1330}
.card{background:radial-gradient(1200px 900px at 85% 0%,#26307a 0%,#0d1330 60%)}
.serif{font-family:'Newsreader',Georgia,serif;font-weight:400}
.photo{position:absolute;inset:0;background:url('${assets.heroPhoto}') center/cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,15,40,.55) 0%,rgba(10,15,40,.72) 45%,rgba(10,15,40,.92) 100%)}
.brand{position:absolute;top:72px;left:80px;font-weight:600;font-size:36px;letter-spacing:-.3px}
.counter{position:absolute;top:78px;right:80px;font-size:28px;color:rgba(255,255,255,.6)}
.block{position:absolute;left:80px;right:80px}
.venue{position:absolute;left:80px;right:80px;border-top:2px solid rgba(255,255,255,.18);padding-top:44px}
.meta{display:flex;align-items:center;gap:24px;margin-top:16px;font-size:34px;color:rgba(255,255,255,.75)}
.pill{border:2px solid rgba(255,255,255,.5);border-radius:999px;padding:9px 24px;font-size:30px}
.pill.free{border:0;background:#2fbf71;color:#06210f;padding:10px 26px;font-weight:600}
.foot{position:absolute;bottom:72px;left:80px;right:80px;display:flex;justify-content:space-between;font-size:28px;color:rgba(255,255,255,.75)}
.kicker{font-size:30px;letter-spacing:4px;text-transform:uppercase;color:#a9b4ff;font-weight:600}
.btn{display:inline-block;background:#5b5bd6;border-radius:18px;padding:22px 38px;font-size:34px;font-weight:600}
</style></head><body>${coverHtml}${cards}${closing}</body></html>`
}
