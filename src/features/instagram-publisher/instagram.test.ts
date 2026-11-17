import { describe, expect, it } from 'vitest'
import { FakeInstagram } from './fake-instagram.ts'
import { InstagramError, emptyPublishState, footerTag, publish, type InstagramApi, type PublishDeps, type PublishJob, type PublishState } from './instagram.ts'

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

function harness(api: FakeInstagram, beforeWrite: () => Promise<void> = async () => {}) {
  const saved: string[] = []
  const deps: PublishDeps = {
    api,
    save: state => { saved.push(JSON.stringify(state)) },
    now: () => new Date(api.clock),
    sleep: async () => {},
    log: () => {},
    beforeWrite,
  }
  return { deps, saved }
}

const reload = (saved: string[]): PublishState => JSON.parse(saved.at(-1)!)
const writes = (api: FakeInstagram) => api.calls.filter(call => call.startsWith('POST'))

describe('carousel publishing', () => {
  it('creates tagged children, the carousel, checks the limit, and publishes once', async () => {
    const api = new FakeInstagram()
    const { deps } = harness(api)
    const permalink = await publish(carousel, emptyPublishState(carousel), deps)
    expect(api.published).toHaveLength(1)
    expect(permalink).toBe(`https://www.instagram.com/p/${api.media[0]!.id}/`)
    const children = [...api.containers.values()].filter(c => c.params.is_carousel_item === 'true')
    expect(children).toHaveLength(3)
    expect(JSON.parse(children[1]!.params.user_tags!)).toEqual([{ username: 'salalucida', x: 0.17, y: 0.93 }])
    const parent = [...api.containers.values()].find(c => c.params.media_type === 'CAROUSEL')!
    expect(parent.params.children).toBe('c1,c2,c3')
    expect(parent.params.caption).toBe(carousel.caption)
    expect(api.calls.indexOf('GET 17841/content_publishing_limit')).toBeLessThan(api.calls.indexOf('POST 17841/media_publish'))
  })

  it('reads the container after a timeout following media_publish and never posts again', async () => {
    const api = new FakeInstagram()
    api.publishFault = 'after'
    const { deps, saved } = harness(api)
    await expect(publish(carousel, emptyPublishState(carousel), deps)).rejects.toThrow(/no response/)
    const afterCrash = reload(saved)
    expect(afterCrash.units[0]!.pendingSince).not.toBeNull()

    api.calls = []
    const permalink = await publish(carousel, afterCrash, deps)
    expect(api.published).toHaveLength(1)
    expect(api.calls[0]).toBe('GET c4')
    expect(writes(api)).toEqual([])
    expect(permalink).toContain(api.media[0]!.id)
  })

  it('retries the same container when the timeout came before anything was posted', async () => {
    const api = new FakeInstagram()
    api.publishFault = 'before'
    const { deps, saved } = harness(api)
    await expect(publish(carousel, emptyPublishState(carousel), deps)).rejects.toThrow()
    const containersBefore = api.containers.size
    await publish(carousel, reload(saved), deps)
    expect(api.published).toHaveLength(1)
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

  it('asks before every write, and stops when told to', async () => {
    const api = new FakeInstagram()
    let asked = 0
    const { deps } = harness(api, async () => { if (++asked === 3) throw new Error('withdrawn') })
    await expect(publish(carousel, emptyPublishState(carousel), deps)).rejects.toThrow('withdrawn')
    expect(writes(api)).toHaveLength(2)
    expect(api.media).toHaveLength(0)
  })

  it('reconciles an unclear publish without asking, even after approval is gone', async () => {
    const api = new FakeInstagram()
    api.publishFault = 'after'
    const first = harness(api)
    await expect(publish(carousel, emptyPublishState(carousel), first.deps)).rejects.toThrow()
    const { deps } = harness(api, async () => { throw new Error('past the deadline') })
    await publish(carousel, reload(first.saved), deps)
    expect(api.published).toHaveLength(1)
  })
})

describe('story publishing', () => {
  it('publishes each frame as a STORIES container with a mention and no coordinates', async () => {
    const api = new FakeInstagram()
    const { deps } = harness(api)
    await publish(story, emptyPublishState(story), deps)
    expect(api.published).toHaveLength(3)
    const frames = [...api.containers.values()]
    expect(frames.every(frame => frame.params.media_type === 'STORIES')).toBe(true)
    expect(JSON.parse(frames[1]!.params.user_tags!)).toEqual([{ username: 'salalucida' }])
  })

  it('after a lost response on frame 2, ties it to its container and goes on to frame 3', async () => {
    const api = new FakeInstagram()
    const { deps, saved } = harness(api)
    let publishes = 0
    const lossy: InstagramApi = { get: api.get.bind(api), post: async (path, params) => { if (path.endsWith('media_publish') && ++publishes === 2) api.publishFault = 'after'; return api.post(path, params) } }
    await expect(publish(story, emptyPublishState(story), { ...deps, api: lossy })).rejects.toThrow()
    await publish(story, reload(saved), deps)
    expect(api.published).toHaveLength(3)
    expect(reload(saved).units.every(unit => unit.published)).toBe(true)
  })

  it("doesn't adopt an unrelated story posted around a failed attempt", async () => {
    const api = new FakeInstagram()
    api.publishFault = 'before'
    const { deps, saved } = harness(api)
    await expect(publish(story, emptyPublishState(story), deps)).rejects.toThrow()
    api.postStoryByHand()
    await publish(story, reload(saved), deps)
    // Frame 1 was retried from its own container rather than taken to be the hand-posted story.
    expect(api.published).toHaveLength(3)
    expect(reload(saved).units.map(unit => unit.mediaId)).not.toContain(api.media.find(media => media.container === null)!.id)
  })

  it('holds instead of reposting when the container state is unknown', async () => {
    const api = new FakeInstagram()
    api.publishFault = 'after'
    const { deps, saved } = harness(api)
    await expect(publish(story, emptyPublishState(story), deps)).rejects.toThrow()
    api.containers.get('c1')!.status = 'IN_PROGRESS'
    api.calls = []
    await expect(publish(story, reload(saved), deps)).rejects.toThrow(/holding/)
    expect(writes(api)).toEqual([])
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
