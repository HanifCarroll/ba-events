/** A fake Instagram account for tests: containers finish at once; media_publish can lose its response or fail first. */
import { InstagramError, type InstagramApi } from './instagram.ts'

export class FakeInstagram implements InstagramApi {
  calls: string[] = []
  containers = new Map<string, { status: string; params: Record<string, string> }>()
  media: Array<{ id: string; caption?: string; timestamp: string; container: string | null; story: boolean }> = []
  next = 1
  /** 'after': post, then throw as if the response was lost. 'before': throw without posting. */
  publishFault: 'after' | 'before' | null = null
  quotaUsage = 0
  clock = Date.parse('2026-11-19T15:00:00.000Z')

  /** Someone else (Hanif, by hand) posts a story on the account. */
  postStoryByHand() {
    this.media.unshift({ id: `m${this.next++}`, timestamp: new Date(this.clock).toISOString(), container: null, story: true })
  }

  get published() { return this.media.filter(media => media.container !== null) }

  async get(path: string, params: Record<string, string> = {}) {
    this.calls.push(`GET ${path}`)
    if (path.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: this.quotaUsage, config: { quota_total: 50 } }] }
    if (path.endsWith('/media')) return { data: this.media.filter(media => !media.story).map(({ id, caption, timestamp }) => ({ id, caption, timestamp })) }
    if (path.endsWith('/stories')) return { data: this.media.filter(media => media.story).map(({ id, timestamp }) => ({ id, timestamp })) }
    if (params.fields === 'permalink') return { permalink: `https://www.instagram.com/p/${path}/` }
    const container = this.containers.get(path)
    if (!container) throw new InstagramError(`unknown ${path}`, true)
    return { status_code: container.status }
  }

  async post(path: string, params: Record<string, string>) {
    this.calls.push(`POST ${path}`)
    if (path.endsWith('/media')) {
      const id = `c${this.next++}`
      this.containers.set(id, { status: 'FINISHED', params })
      return { id }
    }
    if (path.endsWith('/media_publish')) {
      const fault = this.publishFault
      this.publishFault = null
      if (fault === 'before') throw new InstagramError('POST media_publish: no response (TimeoutError)', false)
      const container = this.containers.get(params.creation_id!)!
      if (container.status === 'PUBLISHED') throw new InstagramError('already published', true)
      container.status = 'PUBLISHED'
      const id = `m${this.next++}`
      this.media.unshift({ id, caption: container.params.caption, timestamp: new Date(this.clock).toISOString(), container: params.creation_id!, story: container.params.media_type === 'STORIES' })
      if (fault === 'after') throw new InstagramError('POST media_publish: no response (TimeoutError)', false)
      return { id }
    }
    throw new Error(`unexpected POST ${path}`)
  }
}
