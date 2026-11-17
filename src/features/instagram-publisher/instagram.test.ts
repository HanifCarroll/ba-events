import { describe, expect, it } from 'vitest'
import { InstagramError, emptyPublishState, footerTag, publish, type InstagramApi, type PublishDeps, type PublishJob, type PublishState } from './instagram.ts'

/** A fake Instagram account: containers finish at once, media_publish can be told to time out after or before it posts. */
class FakeInstagram implements InstagramApi {
  calls: string[] = []
  containers = new Map<string, { status: string; params: Record<string, string> }>()
  media: Array<{ id: string; caption?: string; timestamp: string; container: string }> = []
  next = 1
  /** 'after': post, then throw as if the response was lost. 'before': throw without posting. */
  publishFault: 'after' | 'before' | null = null
  quotaUsage = 0
  clock = Date.parse('2026-11-19T15:00:00.000Z')

  async get(path: string, params: Record<string, string> = {}) {
    this.calls.push(`GET ${path}`)
    if (path.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: this.quotaUsage, config: { quota_total: 50 } }] }
    if (path.endsWith('/media') || path.endsWith('/stories')) return { data: this.media.map(({ container: _container, ...media }) => media) }
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
      this.media.unshift({ id, caption: container.params.caption, timestamp: new Date(this.clock).toISOString(), container: params.creation_id! })
      if (fault === 'after') throw new InstagramError('POST media_publish: no response (TimeoutError)', false)
      return { id }
    }
    throw new Error(`unexpected POST ${path}`)
  }
}

const carousel: PublishJob = {
  kind: 'carousel',
  igUserId: '17841',
  caption: 'Seis planes independientes para este finde en Buenos Aires:',
  slides: [
    { url: 'https://img.example/1.jpg', tag: null },
    { url: 'https://img.example/2.jpg', tag: { username: 'salalucida', x: 0.17, y: 0.93 } },
    { url: 'https://img.example/3.jpg', tag: null },
  ],
}

const story: PublishJob = { ...carousel, kind: 'story', caption: null }

function harness(api: FakeInstagram) {
  const saved: string[] = []
  const deps: PublishDeps = {
    api,
    save: state => { saved.push(JSON.stringify(state)) },
    now: () => new Date(api.clock),
    sleep: async () => {},
    log: () => {},
  }
  return { deps, saved }
}

const reload = (saved: string[]): PublishState => JSON.parse(saved.at(-1)!)

describe('carousel publishing', () => {
  it('creates tagged children, the carousel, checks the limit, and publishes once', async () => {
    const api = new FakeInstagram()
    const { deps } = harness(api)
    const state = emptyPublishState(carousel)
    const permalink = await publish(carousel, state, deps)
    expect(api.media).toHaveLength(1)
    expect(permalink).toBe(`https://www.instagram.com/p/${api.media[0]!.id}/`)
    const children = [...api.containers.values()].filter(c => c.params.is_carousel_item === 'true')
    expect(children).toHaveLength(3)
    expect(JSON.parse(children[1]!.params.user_tags!)).toEqual([{ username: 'salalucida', x: 0.17, y: 0.93 }])
    const parent = [...api.containers.values()].find(c => c.params.media_type === 'CAROUSEL')!
    expect(parent.params.children).toBe('c1,c2,c3')
    expect(parent.params.caption).toBe(carousel.caption)
    expect(api.calls.indexOf('GET 17841/content_publishing_limit')).toBeLessThan(api.calls.indexOf('POST 17841/media_publish'))
  })

  it('finds the post after a timeout following media_publish instead of posting again', async () => {
    const api = new FakeInstagram()
    api.publishFault = 'after'
    const { deps, saved } = harness(api)
    await expect(publish(carousel, emptyPublishState(carousel), deps)).rejects.toThrow(/no response/)
    const afterCrash = reload(saved)
    expect(afterCrash.units[0]!.pendingSince).not.toBeNull()
    expect(afterCrash.units[0]!.mediaId).toBeNull()

    // The next tick starts from the saved state, as a new process would.
    api.calls = []
    const permalink = await publish(carousel, afterCrash, deps)
    expect(api.media).toHaveLength(1)
    expect(api.calls[0]).toBe('GET 17841/media')
    expect(api.calls).not.toContain('POST 17841/media_publish')
    expect(permalink).toContain(api.media[0]!.id)
  })

  it('retries the same container when the timeout came before anything was posted', async () => {
    const api = new FakeInstagram()
    api.publishFault = 'before'
    const { deps, saved } = harness(api)
    await expect(publish(carousel, emptyPublishState(carousel), deps)).rejects.toThrow()
    const containersBefore = api.containers.size
    await publish(carousel, reload(saved), deps)
    expect(api.media).toHaveLength(1)
    expect(api.containers.size).toBe(containersBefore)
  })

  it('refuses to publish when the 24-hour limit is used up', async () => {
    const api = new FakeInstagram()
    api.quotaUsage = 50
    const { deps } = harness(api)
    await expect(publish(carousel, emptyPublishState(carousel), deps)).rejects.toThrow(/publishing limit/)
    expect(api.media).toHaveLength(0)
  })

  it('reuses the children it already created after a crash mid-way', async () => {
    const api = new FakeInstagram()
    const { deps, saved } = harness(api)
    let posts = 0
    const flaky: InstagramApi = { get: api.get.bind(api), post: async (path, params) => { if (++posts === 3) throw new InstagramError('POST media: HTTP 500', false); return api.post(path, params) } }
    await expect(publish(carousel, emptyPublishState(carousel), { ...deps, api: flaky })).rejects.toThrow(/500/)
    expect(reload(saved).units[0]!.childIds).toEqual(['c1', 'c2', null])
    await publish(carousel, reload(saved), deps)
    expect([...api.containers.values()].filter(c => c.params.is_carousel_item === 'true')).toHaveLength(3)
  })
})

describe('story publishing', () => {
  it('publishes each frame as a STORIES container with a mention and no coordinates', async () => {
    const api = new FakeInstagram()
    const { deps } = harness(api)
    await publish(story, emptyPublishState(story), deps)
    expect(api.media).toHaveLength(3)
    const frames = [...api.containers.values()]
    expect(frames.every(frame => frame.params.media_type === 'STORIES')).toBe(true)
    expect(JSON.parse(frames[1]!.params.user_tags!)).toEqual([{ username: 'salalucida' }])
  })

  it('after a lost response on frame 2, finds it and goes on to frame 3', async () => {
    const api = new FakeInstagram()
    const { deps, saved } = harness(api)
    let publishes = 0
    const lossy: InstagramApi = { get: api.get.bind(api), post: async (path, params) => { if (path.endsWith('media_publish') && ++publishes === 2) api.publishFault = 'after'; return api.post(path, params) } }
    await expect(publish(story, emptyPublishState(story), { ...deps, api: lossy })).rejects.toThrow()
    expect(api.media).toHaveLength(2)
    await publish(story, reload(saved), deps)
    expect(api.media).toHaveLength(3)
    expect(new Set(reload(saved).units.map(unit => unit.mediaId)).size).toBe(3)
  })
})

describe('tag position', () => {
  it('points at the footer handle', () => {
    const tag = footerTag('salalucida', 1350)!
    expect(tag.x).toBeGreaterThan(0.07)
    expect(tag.x).toBeLessThan(0.3)
    expect(tag.y).toBeCloseTo(0.933, 2)
  })
})
