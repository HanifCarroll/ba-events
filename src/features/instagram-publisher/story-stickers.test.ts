import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { needsFacebookSignIn, selectMentionResult } from './story-composer.ts'
import { eventFrameTag } from './instagram.ts'
import { CARD, LAYOUT_VERSION, STICKER_BAND, mentionArea } from './html.ts'
import { confirmsStory, exactMentionOption, mentionMisplaced, mentionScale, placeChecked, retryComposerOnce, stickerFrames, stickerMisplaced, StoryComposerError } from './story-stickers.ts'

describe('Hoy sticker frames', () => {
  it.each([2, 3, 4])('uses the saved frame and event order for %i events', count => {
    const frames = Array.from({ length: count + 2 }, (_, i) => `/frames/${i + 1}.jpg`)
    const events = Array.from({ length: count }, (_, i) => ({ id: `event-${count - i}`, handle: null, via: false }))
    expect(stickerFrames(frames, events).map(({ path, text, url }) => [path, text, url])).toEqual([
      [frames[0], 'Ver la agenda', 'https://baeventos.com'],
      ...events.map(({ id }, i) => [frames[i + 1], 'Ver evento', `https://baeventos.com/events/${id}`]),
      [frames.at(-1), 'Buscar planes', 'https://baeventos.com'],
    ])
  })

  it('refuses a frame list that cannot map to the events', () => {
    expect(() => stickerFrames(['cover', 'card1', 'close'], [{ id: 'a', handle: null, via: false }, { id: 'b', handle: null, via: false }])).toThrow(/one frame per event/)
  })

  it('uses the same venue and curator usernames as Graph, with no mention when the frame has no tag', () => {
    const frames = ['cover', 'a', 'b', 'c', 'close']
    const events = [
      { id: 'a', handle: 'venue.one', via: false },
      { id: 'b', handle: 'introduces_art', via: true },
      { id: 'c', handle: null, via: false },
    ]
    const mentions = stickerFrames(frames, events).map(frame => frame.mention)
    expect(mentions).toEqual([undefined, 'venue.one', 'introduces_art', undefined, undefined])
    expect(mentions).toEqual(frames.map((_, index) => eventFrameTag(events, index, 1920)?.username))
  })
})

describe('layout versions', () => {
  const frames = ['cover', 'a', 'b', 'close']
  const events = [{ id: 'a', handle: 'venue.one', via: false }, { id: 'b', handle: 'curator', via: true }]

  it('places stickers for an unversioned draft where its older frames left room', () => {
    const old = stickerFrames(frames, events)
    expect(old.map(frame => frame.centerY)).toEqual([1440, 1440, 1440, 1390])
    expect(old[1]!.mentionAt).toEqual({ left: 66, centerY: 1618 })
    expect(old.every(frame => frame.band === undefined)).toBe(true)
  })

  it('places them in the redesigned frames\' free bands for a versioned draft', () => {
    const now = stickerFrames(frames, events, LAYOUT_VERSION)
    expect(now.map(frame => frame.centerY)).toEqual([1440, 1577, 1577, 1390])
    expect(now[1]!.mentionAt).toMatchObject({ left: 66, centerY: CARD.story.footer.centerY })
    expect(now[1]!.band).toEqual(STICKER_BAND.event)
    // A curator's pill is aimed after the printed "Vía", and its area starts after that word.
    expect(now[2]!.mentionAt!.left).toBe(CARD.story.footer.left + CARD.story.footer.via - 14)
    expect(now[2]!.mentionAt!.area!.left).toBeGreaterThan(now[1]!.mentionAt!.area!.left)
    expect(now[2]!.mentionAt!.left).toBeGreaterThan(now[2]!.mentionAt!.area!.left)
  })
})

describe('mention sticker bounds', () => {
  // The composer shows the 1080 × 1920 frame at a quarter size, offset on the page.
  const stage = { x: 100, y: 50, width: 270, height: 480 }
  const box = (left: number, top: number, width: number, height: number) => ({ x: 100 + left / 4, y: 50 + top / 4, width: width / 4, height: height / 4 })
  const curator = stickerFrames(['cover', 'a', 'b', 'close'], [{ id: 'a', handle: 'venue.one', via: false }, { id: 'b', handle: 'agenda.cultural.independiente.x', via: true }], LAYOUT_VERSION)[2]!.mentionAt!
  const { area } = curator
  const centred = (width: number, height: number, dx = 0, dy = 0) => box(curator.left + dx, curator.centerY - height / 2 + dy, width, height)

  it('reserves the printed handle only: not "Vía", the site address, the barrio row, or the link band', () => {
    const { left, right, centerY, gap, viaText, site } = CARD.story.footer
    expect(area).toEqual({ left: left + viaText, right: right - site - 10, top: centerY - 20 - gap, bottom: CARD.story.bottom })
    expect(area!.bottom).toBeLessThanOrEqual(STICKER_BAND.event[0])
    expect(mentionArea(false).left).toBeLessThan(CARD.story.footer.left) // a venue's own handle starts at the row's edge
  })

  it('accepts a pill that lies wholly inside its area, width included', () => {
    expect(mentionMisplaced(centred(300, 76), stage, area!)).toBeNull()
    expect(mentionMisplaced(centred(300, 90), stage, area!)).toBeNull()
  })

  it('shrinks a 30-character curator handle\'s pill until it fits beside "Vía" and before the site address', () => {
    expect(curator.left).toBe(162)
    // As Business Suite first draws it: 31 characters at about 30 px each, 120 px tall.
    const pill = { width: 930, height: 120 }
    const scale = mentionScale(pill, curator)
    expect(scale).toBeLessThan(76 / 120) // narrower than the height rule alone would make it
    const fitted = centred(pill.width * scale, pill.height * scale)
    expect(mentionMisplaced(fitted, stage, area!)).toBeNull()
    // At the height rule's size alone it would run over the site address, and the check refuses it.
    expect(mentionMisplaced(centred(pill.width * 76 / 120, 76), stage, area!)).toMatch(/The mention sticker covers x 162 to 751, y 1394 to 1470, outside its area x 144 to 720, y 1380 to 1484\./)
    // A short handle is only brought down to 76 px, and a pill already small enough is left alone.
    expect(mentionScale({ width: 300, height: 120 }, curator)).toBeCloseTo(76 / 120)
    expect(mentionScale({ width: 300, height: 88 }, curator)).toBe(1)
    // A draft from before layout versions has no area: only the height rule applies.
    expect(mentionScale({ width: 930, height: 120 }, { left: 66 })).toBeCloseTo(76 / 120)
  })

  it('refuses a drag that lands off-centre inside the 32 px tolerance but outside the area', () => {
    // 14 px low still fits a 76 px pill; 30 px low reaches the link sticker's band; 30 px left reaches "Vía".
    expect(mentionMisplaced(centred(300, 76, 0, 14), stage, area!)).toBeNull()
    expect(mentionMisplaced(centred(300, 76, 0, 30), stage, area!)).toMatch(/y 1424 to 1500, outside its area/)
    expect(mentionMisplaced(centred(300, 76, 0, -30), stage, area!)).toMatch(/y 1364 to 1440, outside its area/)
    expect(mentionMisplaced(centred(300, 76, -30, 0), stage, area!)).toMatch(/x 132 to 432/)
    expect(mentionMisplaced(centred(300, 76, 10, 0), stage, area!)).toBeNull()
  })

  it('repositions a misplaced pill once, then fails before Share', async () => {
    const run = async (results: Array<string | null>) => {
      let places = 0
      const outcome = await placeChecked(async () => { places++ }, async () => results.shift() ?? null).then(() => 'placed', error => (error as Error).message)
      return { places, outcome }
    }
    expect(await run([null])).toEqual({ places: 1, outcome: 'placed' })
    expect(await run(['low', null])).toEqual({ places: 2, outcome: 'placed' })
    expect(await run(['low', 'still low'])).toEqual({ places: 2, outcome: 'still low' })
    // A draft from before layout versions has no area, so nothing is checked and it is placed once.
    expect(await run([])).toEqual({ places: 1, outcome: 'placed' })
  })
})

describe('link sticker bounds', () => {
  // The composer shows the 1080 × 1920 frame at a quarter size, offset on the page.
  const stage = { x: 100, y: 50, width: 270, height: 480 }
  const at = (top: number, bottom: number, left = 300, right = 780) => ({ x: 100 + left / 4, y: 50 + top / 4, width: (right - left) / 4, height: (bottom - top) / 4 })

  it('accepts a sticker wholly inside its band', () => {
    expect(stickerMisplaced(at(1510, 1670), stage, STICKER_BAND.event)).toBeNull()
    expect(stickerMisplaced(at(1484, 1644), stage, STICKER_BAND.event)).toBeNull()
  })

  it('refuses one that reaches the words above, the reply bar below, or the frame\'s edge', () => {
    expect(stickerMisplaced(at(1470, 1630), stage, STICKER_BAND.event)).toMatch(/covers y 1470 to 1630, outside its free band 1484 to 1670/)
    expect(stickerMisplaced(at(1520, 1700), stage, STICKER_BAND.event)).toMatch(/outside its free band/)
    expect(stickerMisplaced(at(1480, 1700), stage, STICKER_BAND.event)).toMatch(/outside its free band/) // taller than the band
    expect(stickerMisplaced(at(1510, 1670, 700, 1180), stage, STICKER_BAND.event)).toMatch(/runs off the frame/)
  })
})

describe('Business Suite mention search', () => {
  it('ignores lookalikes and matching display names, not just the first suggestion', () => {
    const options = ['venue.one_ar\nVenue One', 'copy\nvenue.one', 'venueXone\nVenue Uno', 'venue.one\nVenue']
    expect(exactMentionOption(options, 'Venue.One')).toBe(3)
    expect(exactMentionOption(options.slice(0, 3), 'venue.one')).toBeUndefined()
    expect(exactMentionOption([], 'venue.one')).toBeUndefined()
  })

  it('does not select an ambiguous exact result', () => {
    expect(exactMentionOption(['venue.one\nVenue 1', '@venue.one\nVenue 2'], 'venue.one')).toBeUndefined()
  })

  it.each([
    { scenario: 'selects the exact result when Meta opens the list late', opens: true },
    { scenario: 'skips the mention when Meta never opens the list', opens: false },
  ])('$scenario', async ({ opens }) => {
    let reads = 0
    const clicked: string[] = []
    const options = ['venue.one_ar\nvenue.one', 'venue.one\nVenue'].map(innerText => ({
      innerText,
      getClientRects: () => [1],
      getAttribute: () => null,
      click: () => clicked.push(innerText),
    }))
    const getAttribute = (name: string) => name === 'aria-controls' && ++reads > 1 && opens ? 'late-results' : null
    const document = {
      querySelectorAll: () => [{ getAttribute, getClientRects: () => [1] }],
      getElementById: (id: string) => id === 'late-results' ? { querySelectorAll: () => options } : null,
    }
    const tab = {
      async evaluateExpression<T>(expression: string): Promise<T> {
        return runInNewContext(expression, { document, getComputedStyle: () => ({ visibility: 'visible' }) })
      },
    }
    await expect(selectMentionResult(tab, 'venue.one')).resolves.toBe(opens)
    expect(clicked).toEqual(opens ? ['venue.one\nVenue'] : [])
  }, 10_000)
})

describe('Business Suite sign-in loss', () => {
  it.each([
    ['https://www.facebook.com/login/?next=...', ''],
    ['https://www.facebook.com/login.php', ''],
    ['https://business.facebook.com/checkpoint/123', ''],
    ['https://www.facebook.com/auth_platform/callback', ''],
    ['chrome-error://chromewebdata/', ''],
    ['about:blank', 'page.goto: net::ERR_TOO_MANY_REDIRECTS'],
    ['https://business.facebook.com/latest/story_composer/', 'Unable to access Meta Business Suite'],
  ])('recognizes %s %s', (url, message) => {
    expect(needsFacebookSignIn(url, message)).toBe(true)
  })

  it('does not mistake a composer error for sign-in loss', () => {
    expect(needsFacebookSignIn('https://business.facebook.com/latest/story_composer/', 'missing Edit')).toBe(false)
  })
})

it('tries a fresh composer at most once after a recoverable pre-Share error', async () => {
  const error = new StoryComposerError('add the link sticker', false, undefined, true)
  let attempts = 0
  await expect(retryComposerOnce(async () => { attempts++; throw error }, new AbortController().signal)).rejects.toBe(error)
  expect(attempts).toBe(2)
})

it.each([
  { error: new StoryComposerError('read the Share result'), signal: new AbortController().signal },
  { error: new StoryComposerError('add the link sticker', false, undefined, true), signal: AbortSignal.abort() },
])('does not retry $error after the Share gate or flow deadline', async ({ error, signal }) => {
  let attempts = 0
  await expect(retryComposerOnce(async () => { attempts++; throw error }, signal)).rejects.toBe(error)
  expect(attempts).toBe(1)
})

it('only confirms the exact number of new, unique Stories in the attempt window', () => {
  const attempt = { at: '2026-11-20T20:00:00.800Z', frameCount: 4, beforeIds: ['old'] }
  const frames = ['a', 'b', 'c', 'd'].map(id => ({ id, timestamp: '2026-11-20T20:00:00+0000' }))
  const ignored = [
    { id: 'old', timestamp: frames[0]!.timestamp },
    { id: 'earlier', timestamp: '2026-11-20T19:59:59+0000' },
    { id: 'later', timestamp: '2026-11-20T20:05:00+0000' },
    frames[0]!,
  ]
  expect(confirmsStory(attempt, [...frames, ...ignored])).toBe(true)
  expect(confirmsStory(attempt, [...frames.slice(0, 3), ...ignored])).toBe(false)
  expect(confirmsStory(attempt, [...frames, { ...frames[0]!, id: 'unrelated' }])).toBe(false)
})
