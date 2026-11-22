import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { needsFacebookSignIn, selectMentionResult } from './story-composer.ts'
import { eventFrameTag } from './instagram.ts'
import { CARD, LAYOUT_VERSION, STICKER_BAND } from './html.ts'
import { confirmsStory, exactMentionOption, retryComposerOnce, stickerFrames, stickerMisplaced, StoryComposerError } from './story-stickers.ts'

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
    expect(now.map(frame => frame.centerY)).toEqual([1440, 1590, 1590, 1390])
    expect(now[1]!.mentionAt).toEqual({ left: 66, centerY: CARD.story.footer.centerY })
    expect(now[1]!.band).toEqual(STICKER_BAND.event)
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
