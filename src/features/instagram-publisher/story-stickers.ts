import { CARD, STICKER_Y } from './html.ts'
import { eventFrameTag, type InstagramApi } from './instagram.ts'
import type { PostEvent } from './select.ts'

const HOME_PAGE = 'https://baeventos.com'
// Only count frames created close to the click, even if a later tick does the read.
const SHARE_WINDOW_MS = 5 * 60_000
const MENTION_AT = { left: CARD.story.footer.left - 14, centerY: CARD.story.footer.centerY }

export interface StickerFrame {
  path: string
  url: string
  text: string
  centerY: number
  mention?: string
  /** Where the mention sticker goes: over the footer handle, clear of the link sticker. */
  mentionAt?: { left: number; centerY: number }
}

export function stickerFrames(frames: string[], events: Array<Pick<PostEvent, 'id' | 'handle' | 'via'>>): StickerFrame[] {
  if (events.length < 2 || events.length > 4 || frames.length !== events.length + 2) {
    throw new Error('The Hoy draft does not have a cover, one frame per event, and a closing frame.')
  }
  // The renderer saves the cover, the events in draft order, and the closing frame.
  return frames.map((path, index) => {
    if (index === 0) return { path, url: HOME_PAGE, text: 'Ver la agenda', centerY: STICKER_Y.cover }
    if (index === frames.length - 1) return { path, url: HOME_PAGE, text: 'Buscar planes', centerY: STICKER_Y.closing }
    const mention = eventFrameTag(events, index, 1920)?.username
    return { path, url: `${HOME_PAGE}/events/${encodeURIComponent(events[index - 1]!.id)}`, text: 'Ver evento', centerY: STICKER_Y.event, mention, mentionAt: MENTION_AT }
  })
}

/** Each option displays the full username first and the display name on a separate line. */
export function exactMentionOption(options: string[], username: string): number | undefined {
  const matches = options.flatMap((label, index) => {
    const displayedUsername = label.trim().split(/\r?\n/, 1)[0]?.trim().replace(/^@/, '')
    return displayedUsername?.toLowerCase() === username.toLowerCase() ? [index] : []
  })
  return matches.length === 1 ? matches[0] : undefined
}

export interface StoryShareAttempt {
  at: string; frameCount: number; beforeIds: string[]; skippedMentions?: string[]; evidenceDir?: string
}

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

export interface StickerFailure { step: string; signIn: boolean; evidenceDir?: string }

export class StoryComposerError extends Error implements StickerFailure {
  constructor(readonly step: string, readonly signIn = false, readonly evidenceDir?: string, readonly retryable = false) {
    const message = signIn ? 'Meta Business Suite needs a Facebook sign-in on the Pro.' : `Could not ${step}.`
    super(evidenceDir ? `${message} Composer evidence: ${evidenceDir}` : message)
  }
}

export async function retryComposerOnce<T>(run: () => Promise<T>, cap: AbortSignal): Promise<T> {
  try { return await run() }
  catch (error) {
    if (!(error instanceof StoryComposerError) || !error.retryable || cap.aborted) throw error
    console.warn(`${error.message} Trying a fresh composer before Share.`)
    return run()
  }
}

export type ComposeStory = (frames: StickerFrame[], action: {
  evidenceDir: string
  beforeShare(signal: AbortSignal, skippedMentions: string[]): Promise<void>
} | { previewDir: string }) => Promise<string[]>
