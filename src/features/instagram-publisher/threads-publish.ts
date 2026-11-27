import { PublishStop, type Reactions } from './approval.ts'
import { TICK_MS } from './formats.ts'
import { ThreadsError, type ThreadsApi } from './threads-api.ts'
import { threadsReplies, type threadsWindow } from './threads-copy.ts'

export interface ThreadsDraft {
  state: 'waiting' | 'publishing' | 'published' | 'skipped' | 'held' | 'failed'
  /** Frozen before the preview is sent: this is also the exact recovery key. */
  text: string | null
  /** Auto mode saved for the original revision; absent on older drafts means manual. */
  auto?: boolean
  /** Revision that owns this attempt, even when it had no Slack preview. */
  revision?: number
  containerId: string | null
  mediaId: string | null
  permalink: string | null
  /** Durable before dispatch. An unclear publish leaves it set and forbids another write. */
  attemptedAt: string | null
  /** The latest media IDs already visible when the publish was dispatched. */
  beforeIds?: string[]
  /** A preserved send keeps its original Slack thread when Instagram gets another revision. */
  threadTs?: string
  threadChannel?: string
  publishedAt: string | null
  error: string | null
  failures: number
  notify: string | null
  failureAlertSent?: boolean
  hold?: NonNullable<PublishStop['stale']>
  holdAlertSent?: boolean
}

export function newThreadsDraft(text: string | null, auto: boolean): ThreadsDraft {
  const error = text === null ? 'la lista no cabe en 500 caracteres' : null
  return { state: error ? 'failed' : 'waiting', text, auto, containerId: null, mediaId: null, permalink: null, attemptedAt: null,
    publishedAt: null, error, failures: 0, notify: error ? threadsReplies.failed(error) : null }
}

const isOpen = (draft: ThreadsDraft) => draft.state === 'waiting' || draft.state === 'publishing'

/** Do not offer a replacement for a sent, skipped, or failed Threads post. A hold can still be repaired. */
export const retainThreads = (draft: ThreadsDraft) => Boolean(draft.attemptedAt || draft.mediaId)
  || ['published', 'skipped', 'failed'].includes(draft.state)

function settle(draft: ThreadsDraft, state: 'skipped' | 'held' | 'failed' | 'published', notify: string | null) {
  draft.state = state
  draft.notify = notify
}

/** Reactions or an event hold that Instagram already observed apply to Threads too, but cannot undo a dispatched publish. */
export function stopThreads(draft: ThreadsDraft, stop: 'rejected' | 'delegated-skip' | { title: string }) {
  if (!isOpen(draft) || draft.attemptedAt || draft.mediaId) return
  if (stop === 'delegated-skip') settle(draft, 'skipped', null) // The command acknowledges the veto in the preview thread.
  else if (stop === 'rejected') settle(draft, 'skipped', threadsReplies.rejected)
  else settle(draft, 'held', threadsReplies.held(stop.title))
}

interface Services {
  api(): Promise<ThreadsApi>
  now(): Date
  sleep(ms: number): Promise<void>
  save(): void
  reactions(): Promise<Reactions>
  enabled(): boolean
  auto(): boolean
  checkEvents(): Promise<void>
  reply?(text: string): Promise<unknown>
  log(text: string): void
}

const MAX_FAILURES = 6

export async function advanceThreads(draft: ThreadsDraft, window: ReturnType<typeof threadsWindow>, s: Services) {
  if (isOpen(draft)) {
    const pendingUntil = draft.attemptedAt ? Math.max(window.cutoff.getTime(), Date.parse(draft.attemptedAt) + TICK_MS) : null
    const fail = (reason: string) => {
      draft.error = reason
      settle(draft, 'failed', threadsReplies.failed(reason))
    }
    const confirm = async (api: ThreadsApi) => {
      const permalink = await api.permalink(draft.mediaId!)
      draft.permalink = permalink
      draft.error = null
      settle(draft, 'published', threadsReplies.published(permalink))
      s.save()
    }
    let eventsChecked = false
    const checkGate = async () => {
      if (s.now() >= window.cutoff) throw new PublishStop('deadline', 'Threads cutoff reached')
      if (s.now() < window.publishAt) throw new PublishStop('unapproved', 'Waiting for Threads slot')
      const reactions = await s.reactions().catch(() => {
        if (s.now() >= window.cutoff) throw new PublishStop('deadline', 'Threads cutoff reached')
        s.log('Threads: no se pudo leer la aprobación de Slack; se reintenta en el próximo tick')
        throw new PublishStop('unapproved', 'Waiting for a successful Slack reaction read')
      })
      if (reactions.rejected) throw new PublishStop('rejected', 'Hanif reacted ❌')
      if (s.now() >= window.cutoff) throw new PublishStop('deadline', 'Threads cutoff reached')
      if (!reactions.approved && !(draft.auto === true && s.auto())) throw new PublishStop('unapproved', 'Waiting for Threads approval')
    }
    const checkEventsOnce = async () => {
      if (!eventsChecked) { await s.checkEvents(); eventsChecked = true }
    }
    try {
      if (draft.mediaId) {
        await confirm(await s.api())
      } else if (draft.attemptedAt) {
        const api = await s.api()
        const since = Date.parse(draft.attemptedAt)
        const before = draft.beforeIds && new Set(draft.beforeIds)
        // Older drafts without a pre-dispatch snapshot keep the stricter comparison.
        const matches = (await api.recent()).flatMap(post => {
          if (!post.id || post.text !== draft.text) return []
          const stamp = Date.parse(post.timestamp?.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') ?? '')
          const recent = before ? stamp >= Math.floor(since / 1000) * 1000 && !before.has(post.id) : stamp > since
          return recent ? [{ id: post.id, stamp }] : []
        })
        if (matches.length === 1) {
          const post = matches[0]!
          draft.mediaId = post.id
          draft.publishedAt = new Date(post.stamp).toISOString()
          draft.failures = 0
          s.save()
          await confirm(api)
        } else if (s.now().getTime() >= pendingUntil!) {
          fail(matches.length ? 'hay varias publicaciones con el mismo texto' : 'no se pudo confirmar la publicación')
          s.save()
        }
      } else {
        await checkGate()
        const api = await s.api()
        if (!draft.containerId) {
          await checkEventsOnce()
          await api.checkLimit()
          await checkGate()
          if (!s.enabled()) return
          draft.containerId = await api.create(draft.text!)
          draft.state = 'publishing'
          s.save()
        }
        let ready = false
        // Four reads of at most 10s each, with up to three 5s waits.
        for (let poll = 0; poll < 4; poll++) {
          if (!s.enabled()) return
          const status = await api.status(draft.containerId)
          if (!s.enabled()) return
          if (status === 'FINISHED') { ready = true; break }
          if (status === 'ERROR' || status === 'EXPIRED') {
            draft.containerId = null
            throw new ThreadsError(`contenedor ${status === 'EXPIRED' ? 'vencido' : 'con error'}`)
          }
          if (status !== 'IN_PROGRESS') throw new ThreadsError('estado inesperado del contenedor')
          if (poll < 3) await s.sleep(5_000)
        }
        if (!ready) return
        await checkEventsOnce()
        await api.checkLimit()
        const beforeIds = (await api.recent()).map(post => post.id)
        await checkGate()
        if (!s.enabled()) return
        draft.beforeIds = beforeIds
        draft.attemptedAt = s.now().toISOString()
        s.save()
        try {
          draft.mediaId = await api.publish(draft.containerId)
        } catch (error) {
          if (error instanceof ThreadsError && error.definitive) {
            draft.attemptedAt = null
            delete draft.beforeIds
          }
          throw error
        }
        draft.publishedAt = s.now().toISOString()
        draft.failures = 0
        s.save()
        await confirm(api)
      }
    } catch (error) {
      if (error instanceof PublishStop) {
        if (error.kind === 'unapproved') return
        if (error.kind === 'deadline') settle(draft, 'skipped', threadsReplies.cutoff(window.cutoff))
        if (error.kind === 'rejected') stopThreads(draft, 'rejected')
        if (error.kind === 'stale' && error.stale) {
          draft.hold = error.stale
          stopThreads(draft, error.stale)
        }
      } else {
        const reason = error instanceof ThreadsError ? error.message : 'no se pudo completar el intento'
        s.log(`Threads: ${reason}`)
        draft.error = reason
        if (error instanceof ThreadsError) draft.failures++
        if (!draft.mediaId && draft.attemptedAt) {
          if (pendingUntil !== null && s.now().getTime() >= pendingUntil) fail('no se pudo confirmar la publicación')
        } else if (draft.failures >= MAX_FAILURES) {
          if (draft.mediaId) settle(draft, 'published', threadsReplies.failed('se publicó, pero no se pudo obtener el enlace'))
          else fail(reason)
        }
      }
      s.save()
    }
  }
  if (draft.notify) {
    try { await s.reply?.(draft.notify) } catch {
      s.log('Threads: no se pudo enviar la respuesta de Slack; se reintenta en el próximo tick')
      return
    }
    draft.notify = null
    s.save()
  }
}
