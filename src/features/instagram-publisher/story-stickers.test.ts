import { describe, expect, it } from 'vitest'
import { needsFacebookSignIn } from './story-composer.ts'
import { confirmsStory, stickerFrames } from './story-stickers.ts'

describe('Hoy sticker frames', () => {
  it.each([2, 3, 4])('uses the saved frame and event order for %i events', count => {
    const frames = Array.from({ length: count + 2 }, (_, i) => `/frames/${i + 1}.jpg`)
    const events = Array.from({ length: count }, (_, i) => ({ id: `event-${count - i}` }))
    expect(stickerFrames(frames, events).map(({ path, text, url }) => [path, text, url])).toEqual([
      [frames[0], 'Ver la agenda', 'https://baeventos.com'],
      ...events.map(({ id }, i) => [frames[i + 1], 'Ver evento', `https://baeventos.com/events/${id}`]),
      [frames.at(-1), 'Buscar planes', 'https://baeventos.com'],
    ])
  })

  it('refuses a frame list that cannot map to the events', () => {
    expect(() => stickerFrames(['cover', 'card1', 'close'], [{ id: 'a' }, { id: 'b' }])).toThrow(/one frame per event/)
  })
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
