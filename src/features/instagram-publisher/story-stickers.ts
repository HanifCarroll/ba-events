import { LEGACY_LAYOUT, MENTION_SLACK, STICKER_BAND, STICKER_Y, mentionArea } from './html.ts'
import { eventFrameTag, type InstagramApi } from './instagram.ts'
import type { PostEvent } from './select.ts'

const HOME_PAGE = 'https://baeventos.com'
// Only count frames created close to the click, even if a later tick does the read.
const SHARE_WINDOW_MS = 5 * 60_000
/** The frame-pixel rectangle a mention pill must end up inside. */
export interface Area { left: number; right: number; top: number; bottom: number }

/** The pill is aimed at the printed handle; `area` is all the room it may take (html.ts `mentionArea`). */
function mentionAt(via: boolean): { left: number; centerY: number; area: Area } {
  const { aim, ...area } = mentionArea(via)
  return { ...aim, area }
}

export interface StickerFrame {
  path: string
  url: string
  text: string
  centerY: number
  mention?: string
  /**
   * Where the mention sticker goes: over the footer handle. `area` is the rectangle its final box must fit, clear of
   * "Vía", the site's address, the barrio row, and the link sticker's band. Frames from before layout versions have none.
   */
  mentionAt?: { left: number; centerY: number; area?: Area }
  /** The band the placed link sticker must fit inside, top and bottom. Frames from before layout versions have none. */
  band?: readonly [number, number]
}

/** `layout` is the draft's saved layout version; a draft without one gets the positions its older frames were drawn for. */
export function stickerFrames(frames: string[], events: Array<Pick<PostEvent, 'id' | 'handle' | 'via'>>, layout?: number): StickerFrame[] {
  if (events.length < 2 || events.length > 4 || frames.length !== events.length + 2) {
    throw new Error('The Hoy draft does not have a cover, one frame per event, and a closing frame.')
  }
  // The renderer saves the cover, the events in draft order, and the closing frame.
  const legacy = layout === undefined
  const y = legacy ? LEGACY_LAYOUT.sticker : STICKER_Y
  const band = (kind: keyof typeof STICKER_BAND) => legacy ? {} : { band: STICKER_BAND[kind] }
  return frames.map((path, index) => {
    if (index === 0) return { path, url: HOME_PAGE, text: 'Ver la agenda', centerY: y.cover, ...band('cover') }
    if (index === frames.length - 1) return { path, url: HOME_PAGE, text: 'Buscar planes', centerY: y.closing, ...band('closing') }
    const event = events[index - 1]!
    const mention = eventFrameTag(events, index, 1920, layout)?.username
    return {
      path, url: `${HOME_PAGE}/events/${encodeURIComponent(event.id)}`, text: 'Ver evento', centerY: y.event, mention,
      mentionAt: legacy ? LEGACY_LAYOUT.mention : mentionAt(event.via), ...band('event'),
    }
  })
}

type Rect = { x: number; y: number; width: number; height: number }

/** A page-pixel box as frame pixels; the stage is the whole 1080 × 1920 frame. */
function inFrame(box: Rect, stage: Rect): Area {
  const px = stage.height / 1920
  return { left: (box.x - stage.x) / px, right: (box.x + box.width - stage.x) / px, top: (box.y - stage.y) / px, bottom: (box.y + box.height - stage.y) / px }
}

/**
 * Why a placed link sticker can't be shared, or null when it lies wholly inside the frame's width and its free band.
 * `box` and `stage` are in page pixels.
 */
export function stickerMisplaced(box: Rect, stage: Rect, band: readonly [number, number]): string | null {
  const { left, right, top, bottom } = inFrame(box, stage)
  if (top < band[0] - 1 || bottom > band[1] + 1) return `The link sticker covers y ${Math.round(top)} to ${Math.round(bottom)}, outside its free band ${band[0]} to ${band[1]}.`
  if (left < -1 || right > 1081) return `The link sticker runs off the frame (x ${Math.round(left)} to ${Math.round(right)}).`
  return null
}

/** Why a placed mention pill can't be shared, or null when its whole box, width included, lies inside its area. */
export function mentionMisplaced(box: Rect, stage: Rect, area: Area): string | null {
  const at = inFrame(box, stage)
  if (at.left >= area.left - 1 && at.right <= area.right + 1 && at.top >= area.top - 1 && at.bottom <= area.bottom + 1) return null
  const span = (r: Area) => `x ${Math.round(r.left)} to ${Math.round(r.right)}, y ${Math.round(r.top)} to ${Math.round(r.bottom)}`
  return `The mention sticker covers ${span(at)}, outside its area ${span(area)}.`
}

/** A pill is shrunk to this height when it comes out taller than MENTION_MAX. */
const MENTION_HEIGHT = 76
export const MENTION_MAX = 90

/**
 * How much to shrink a mention pill (frame pixels), or 1 to leave it: to MENTION_HEIGHT when it is taller than
 * MENTION_MAX, and further when a long username makes it wider than the room from its aimed left edge to its area's end.
 */
export function mentionScale(pill: { width: number; height: number }, at: { left: number; area?: Area }): number {
  const height = pill.height > MENTION_MAX ? MENTION_HEIGHT / pill.height : 1
  const room = at.area ? at.area.right - at.left - MENTION_SLACK : Infinity
  return Math.min(1, height, room / pill.width)
}

/**
 * Place a sticker, then accept it only where `misplaced` finds nothing wrong with its measured box. A sticker that
 * landed off its mark is placed once more; if it is still wrong this throws, which ends the composer before Share.
 */
export async function placeChecked(place: () => Promise<void>, misplaced: () => Promise<string | null>): Promise<void> {
  await place()
  if (!await misplaced()) return
  await place()
  const problem = await misplaced()
  if (problem) throw new Error(problem)
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
