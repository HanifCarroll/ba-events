import type { InstagramApi } from './instagram.ts'

const HOME_PAGE = 'https://baeventos.com'
// Only count frames created close to the click, even if a later tick does the read.
const SHARE_WINDOW_MS = 5 * 60_000

export interface StickerFrame {
  path: string
  url: string
  text: string
  centerY: number
}

export function stickerFrames(frames: string[], events: Array<{ id: string }>): StickerFrame[] {
  if (events.length < 2 || events.length > 4 || frames.length !== events.length + 2) {
    throw new Error('The Hoy draft does not have a cover, one frame per event, and a closing frame.')
  }
  // The renderer saves the cover, the events in draft order, and the closing frame.
  return frames.map((path, index) => {
    if (index === 0) return { path, url: HOME_PAGE, text: 'Ver la agenda', centerY: 1440 }
    if (index === frames.length - 1) return { path, url: HOME_PAGE, text: 'Buscar planes', centerY: 1390 }
    return { path, url: `${HOME_PAGE}/events/${encodeURIComponent(events[index - 1]!.id)}`, text: 'Ver evento', centerY: 1440 }
  })
}

export interface StoryShareAttempt { at: string; frameCount: number; beforeIds: string[] }

export async function liveStories(api: InstagramApi, userId: string): Promise<Array<{ id: string; timestamp: string }>> {
  const { data } = await api.get(`${userId}/stories`, { fields: 'id,timestamp', limit: '100' })
  if (!Array.isArray(data) || data.some(story => typeof story?.id !== 'string' || !Number.isFinite(Date.parse(story.timestamp)))) {
    throw new Error('Instagram returned an invalid list of Stories.')
  }
  return data
}

export function confirmsStory(attempt: StoryShareAttempt, stories: Awaited<ReturnType<typeof liveStories>>) {
  const since = Math.floor(Date.parse(attempt.at) / 1000) * 1000 // Graph reports whole seconds.
  const known = new Set(attempt.beforeIds)
  const newIds = new Set(stories.filter(story => {
    const time = Date.parse(story.timestamp)
    return !known.has(story.id) && time >= since && time < since + SHARE_WINDOW_MS
  }).map(story => story.id))
  return newIds.size === attempt.frameCount
}

export interface StickerFailure { step: string; signIn: boolean }

export class StoryComposerError extends Error implements StickerFailure {
  constructor(readonly step: string, readonly signIn = false) {
    super(signIn ? 'Meta Business Suite needs a Facebook sign-in on the Pro.' : `Could not ${step}.`)
  }
}

export type ComposeStory = (frames: StickerFrame[], action: { beforeShare(signal: AbortSignal): Promise<void> } | { previewDir: string }) => Promise<void>
