/** Drives `tick` and `regenerate` through the draft lifecycle with fake Slack, D1, R2, rendering, and Instagram. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HANIF } from './approval.ts'
import { FakeInstagram } from './fake-instagram.ts'
import { baInstant } from './format.ts'
import type { RunWindow } from './formats.ts'
import { Job, type Draft, type Services } from './job.ts'
import type { Config } from './runtime.ts'
import type { CatalogEvent } from './select.ts'

/** A music directory with three synthetic tracks (the files only need to exist; the fake render never reads them). */
function musicDir(tracks = [{ id: 'a', bpm: 90, startSec: 1 }, { id: 'b', bpm: 120, startSec: 2 }, { id: 'c', bpm: 100, startSec: 0 }]) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-music-'))
  writeFileSync(join(dir, 'tracks.json'), JSON.stringify({ tracks: tracks.map(t => ({ title: `Track ${t.id}`, artist: 'Synth', file: `${t.id}.flac`, durationSec: 60, credit: null, ...t })) }))
  for (const t of tracks) writeFileSync(join(dir, `${t.id}.flac`), 'synthetic')
  return dir
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Six qualifying weekend events (Friday 20 to Sunday 22, November 2026) at six venues. */
const weekend = (): CatalogEvent[] => Array.from({ length: 6 }, (_, i) => ({
  id: uuid(i + 1),
  name: `Evento ${i + 1}`,
  startsAt: new Date(baInstant(`2026-11-${20 + (i % 3)}`, 21).getTime() + i * 60_000).toISOString(),
  endsAt: null,
  price: i === 0 ? 0 : null,
  isFree: i === 0,
  payWhatYouWant: false,
  status: 'scheduled',
  timeTba: false,
  isAllDay: false,
  categories: ['music'],
  summary: 'Una noche de música.',
  venue: `Sala ${i + 1}`,
  barrio: ['Palermo', 'Boedo', 'Almagro', 'Flores', 'Saavedra', 'Chacarita'][i]!,
  venueHandle: `sala${i + 1}`,
  sourceAccount: null,
  intakeTimeUnknown: false,
}))

class World {
  dir = mkdtempSync(join(tmpdir(), 'ig-job-'))
  clock = baInstant('2026-11-18', 18, 5)
  ig = new FakeInstagram()
  catalog = weekend()
  statuses = new Map<string, string>()
  reactions: Array<{ name: string; users?: string[] }> = []
  /** Reactions on the Reel's preview; `reactions` covers every other preview. */
  reelReactions: Array<{ name: string; users?: string[] }> = []
  slackPosts: Array<{ text: string; threadTs?: string }> = []
  /** Fail this many Slack replies whose text starts with the prefix. */
  slackFails = 0
  slackFailPrefix = ''
  alerts: Array<{ key: string; text: string }> = []
  resolved: string[] = []
  r2: string[] = []
  music = musicDir()
  config: Config = { auto: { hoy: false, finde: false, gratis: false, reel: false }, r2: { bucket: 'b', publicBaseUrl: 'https://ig.example' }, reel: { musicDir: this.music } }
  reelRenders: Array<{ track: string; total: number; events: string[] }> = []
  renderCount = 0
  nextTs = 1

  services(): Services {
    return {
      stateDir: this.dir,
      repo: this.dir,
      now: () => new Date(this.clock),
      config: () => this.config,
      readCatalog: async (_window: RunWindow) => this.catalog,
      readEvents: async ids => new Map(ids.map(id => {
        const event = this.catalog.find(candidate => candidate.id === id)!
        return [id, { status: this.statuses.get(id) ?? 'scheduled', startsAt: event.startsAt, endsAt: event.endsAt }]
      })),
      render: async (_html, outDir, _height) => {
        this.renderCount++
        const { mkdirSync } = await import('node:fs')
        mkdirSync(outDir, { recursive: true })
        return Array.from({ length: 8 }, (_, i) => { const path = join(outDir, `frame-${i + 1}.jpg`); writeFileSync(path, `render ${this.renderCount} frame ${i + 1}`); return path })
      },
      renderReel: async (_window, events, timing, track, outDir) => {
        this.renderCount++
        this.reelRenders.push({ track: track.id, total: timing.total, events: events.map(event => event.id) })
        const { mkdirSync } = await import('node:fs')
        mkdirSync(outDir, { recursive: true })
        return ['reel.mp4', 'cover.jpg'].map(name => { const path = join(outDir, name); writeFileSync(path, `render ${this.renderCount} ${name}`); return path })
      },
      slackUploadFiles: async (frames, id) => frames.map((_, i) => ({ id: `F${id}-${this.renderCount}-${i}`, title: `${id}-${i}` })),
      slackShareFiles: async (_files, text) => { this.slackPosts.push({ text }) },
      slackShareTs: async () => `${this.nextTs++}.0`,
      slackPost: async (text, threadTs) => {
        if (this.slackFails > 0 && text.startsWith(this.slackFailPrefix)) { this.slackFails--; throw new Error('Slack chat.postMessage failed: ratelimited') }
        this.slackPosts.push({ text, threadTs })
        return { ts: `${this.nextTs++}.0` }
      },
      slackReactions: async ts => ts === this.reel()?.slack.ts ? this.reelReactions : this.reactions,
      r2Put: async (_bucket, key) => { this.r2.push(key) },
      loadToken: async () => ({ state: 'ok', token: { access_token: 'T', ig_user_id: '17841', expires_at: '2027-01-01T00:00:00.000Z' }, warning: null }),
      instagram: () => this.ig,
      alert: async (key, _title, text) => { this.alerts.push({ key, text }) },
      resolveAlert: async key => { this.resolved.push(key) },
      sleep: async () => {},
      log: () => {},
    }
  }

  job() { return new Job(this.services()) }
  at(date: string, hour: number, minute = 0) { this.clock = baInstant(date, hour, minute); this.ig.clock = this.clock.getTime() }
  approve() { this.reactions = [{ name: 'white_check_mark', users: [HANIF] }] }
  reject() { this.reactions = [{ name: 'x', users: [HANIF] }] }
  draft(): Draft { return JSON.parse(readFileSync(join(this.dir, 'drafts', 'finde-2026-11-20.json'), 'utf8')) }
  reel(id = 'reel-2026-11-20'): Draft | null {
    try { return JSON.parse(readFileSync(join(this.dir, 'drafts', `${id}.json`), 'utf8')) } catch { return null }
  }
  replies() { return this.slackPosts.filter(post => post.threadTs).map(post => post.text) }
}

async function previewed() {
  const w = new World()
  await w.job().tick() // Wednesday 18:05: the Este finde draft is previewed
  expect(w.draft().state).toBe('previewed')
  return w
}

describe('tick: approval and publishing', () => {
  it('publishes an approved carousel at its slot and replies with the permalink', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-19', 11, 50)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
    expect(w.draft().state).toBe('published')
    expect(w.replies()).toEqual([`Posted: https://www.instagram.com/p/${w.ig.media[0]!.id}/`])
  })

  it('stops a retry when Hanif reacts ❌ after a failed attempt', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-19', 12)
    w.ig.quotaUsage = 50 // the first attempt fails before media_publish
    await w.job().tick()
    expect(w.draft().state).toBe('publishing')
    w.ig.quotaUsage = 0
    w.reject()
    w.at('2026-11-19', 12, 10)
    const writesBefore = w.ig.calls.filter(call => call.startsWith('POST')).length
    await w.job().tick()
    expect(w.ig.calls.filter(call => call.startsWith('POST')).length).toBe(writesBefore)
    expect(w.ig.published).toHaveLength(0)
    expect(w.draft().state).toBe('skipped')
    expect(w.replies()).toEqual(['Skipped: you reacted ❌'])
  })

  it('waits, without writing, while the ✅ has been removed', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-19', 12)
    w.ig.quotaUsage = 50
    await w.job().tick()
    w.ig.quotaUsage = 0
    w.reactions = []
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    expect(w.draft().state).toBe('publishing')
    w.approve()
    w.at('2026-11-19', 12, 20)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
  })

  it('never starts new media after the deadline, but reconciles an unclear publish', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-20', 17, 50)
    w.ig.publishFault = 'after'
    await w.job().tick()
    expect(w.draft().publish!.units[0]!.pendingSince).not.toBeNull()
    w.at('2026-11-20', 18, 30) // past Friday 18:00
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
    expect(w.draft().state).toBe('published')
  })

  it('skips an approved draft that could not go out before the deadline', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-20', 17, 50)
    w.ig.quotaUsage = 50
    await w.job().tick()
    w.ig.quotaUsage = 0
    w.at('2026-11-20', 18)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    // The Reel, drafted Thursday with no ✅, is skipped at the same moment in its own thread.
    expect(w.slackPosts.filter(post => post.threadTs === w.draft().slack.ts).map(post => post.text)).toEqual(['Skipped: not published by 18:00'])
  })

  it('a ✅ seen before the cutoff does not publish a day later', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-19', 9)
    await w.job().tick() // ✅ recorded, waits for the slot
    w.config = { ...w.config, r2: null } // publishing can't happen yet
    w.at('2026-11-19', 12)
    await w.job().tick()
    w.config = { ...w.config, r2: { bucket: 'b', publicBaseUrl: 'https://ig.example' } }
    w.at('2026-11-21', 12)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    expect(w.draft().state).not.toBe('published')
  })
})

describe('tick: cancelled events', () => {
  it('holds the draft and asks for a regenerate when an event was cancelled', async () => {
    const w = await previewed()
    w.approve()
    w.statuses.set(uuid(3), 'canceled')
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.ig.calls.filter(call => call.startsWith('POST'))).toEqual([])
    expect(w.draft().state).toBe('held')
    expect(w.replies()).toEqual(['Held: Evento 3 was cancelled. Ask Hermes to regenerate it.'])
    expect(w.alerts.some(alert => alert.key === 'draft/finde-2026-11-20' && alert.text.includes(`--exclude ${uuid(3)}`))).toBe(true)
  })
})

describe('tick: events checked at the real publishing time', () => {
  it('holds a late approval when an event has already ended', async () => {
    const w = new World()
    // Event 1 runs Friday 10:00 to 11:00: after Thursday's slot, so it is selected, but over before a Friday-noon ✅.
    w.catalog[0] = { ...w.catalog[0]!, startsAt: baInstant('2026-11-20', 10).toISOString(), endsAt: baInstant('2026-11-20', 11).toISOString() }
    await w.job().tick()
    expect(w.draft().events.map(event => event.id)).toContain(uuid(1))
    w.at('2026-11-20', 12)
    w.approve()
    await w.job().tick()
    expect(w.ig.calls.filter(call => call.startsWith('POST'))).toEqual([])
    expect(w.r2).toEqual([])
    expect(w.draft().state).toBe('held')
    expect(w.replies()).toEqual(['Held: Evento 1 has already happened. Ask Hermes to regenerate it.'])
    expect(w.alerts.find(alert => alert.key === 'draft/finde-2026-11-20')!.text).toContain(`--exclude ${uuid(1)}`)
  })

  it('holds a retry when an event was cancelled between two attempts', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-19', 12)
    w.ig.quotaUsage = 50 // the first attempt creates containers, then stops before media_publish
    await w.job().tick()
    expect(w.draft().state).toBe('publishing')
    w.ig.quotaUsage = 0
    w.statuses.set(uuid(4), 'canceled')
    w.at('2026-11-19', 12, 10)
    const before = w.ig.calls.filter(call => call.startsWith('POST')).length
    await w.job().tick()
    expect(w.ig.calls.filter(call => call.startsWith('POST')).length).toBe(before)
    expect(w.ig.published).toHaveLength(0)
    expect(w.draft().state).toBe('held')
    expect(w.replies()).toEqual(['Held: Evento 4 was cancelled. Ask Hermes to regenerate it.'])
    const alert = w.alerts.find(a => a.key === 'draft/finde-2026-11-20' && a.text.startsWith('Held:'))!
    expect(alert.text).toContain('scripts/instagram-publisher.ts status')
    expect(alert.text).not.toContain('regenerate finde')
  })

  it('still settles an unclear publish after an event was cancelled', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-19', 12)
    w.ig.publishFault = 'after'
    await w.job().tick()
    w.statuses.set(uuid(4), 'canceled')
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
    expect(w.draft().state).toBe('published')
  })
})

describe('tick: Slack replies', () => {
  it('keeps the outcome and retries the Slack reply, alerting that the post went out', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-19', 12)
    w.slackFails = 1
    w.slackFailPrefix = 'Posted:'
    await w.job().tick()
    expect(w.draft().state).toBe('published')
    expect(w.draft().notify?.text).toMatch(/^Posted: /)
    expect(w.alerts.find(alert => alert.key === 'draft/finde-2026-11-20/slack')!.text).toMatch(/went out on Instagram .*but the Slack reply failed/)
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.draft().notify).toBeNull()
    expect(w.replies().filter(text => text.startsWith('Posted:'))).toHaveLength(1)
    expect(w.ig.published).toHaveLength(1)
  })
})

describe('regenerate', () => {
  it('clears approval, previews a new revision, and needs a new ✅', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-19', 9)
    await w.job().tick()
    expect(w.draft().approvedSeenAt).not.toBeNull()
    const draft = await w.job().regenerate('finde-2026-11-20', [uuid(2)])
    expect(draft.revision).toBe(2)
    expect(draft.approvedSeenAt).toBeNull()
    expect(draft.events.map(event => event.id)).not.toContain(uuid(2))
    expect(draft.frames.every(path => path.includes('/rev-2/'))).toBe(true)
    expect(w.slackPosts.filter(post => !post.threadTs)).toHaveLength(2)
  })

  it('a crashed regenerate leaves a draft that cannot publish', async () => {
    const w = await previewed()
    w.approve()
    const job = w.job()
    // The render fails after approval is cleared.
    ;(job.s as { render: Services['render'] }).render = async () => { throw new Error('render crashed') }
    await expect(job.regenerate('finde-2026-11-20', [uuid(2)])).rejects.toThrow('render crashed')
    expect(w.draft()).toMatchObject({ state: 'rebuilding', approvedSeenAt: null, revision: 2 })
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.ig.calls).toEqual([])
    expect(w.draft().state).toBe('failed')
    const alert = w.alerts.find(a => a.key === 'draft/finde-2026-11-20')!
    expect(alert.text).toContain("stopped part-way")
    expect(alert.text).toContain(`regenerate finde-2026-11-20 --exclude ${uuid(2)}`)
    // A later tick that succeeds doesn't clear the draft's alert.
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.resolved).not.toContain('draft/finde-2026-11-20')
  })

  it('alerts when the preview never reached Slack before the cutoff', async () => {
    const w = new World()
    const job = w.job()
    ;(job.s as { slackShareTs: Services['slackShareTs'] }).slackShareTs = async () => null
    await job.tick() // uploaded, but Slack never reports the message
    expect(w.draft().state).toBe('previewing')
    w.at('2026-11-20', 18)
    await w.job().tick()
    expect(w.draft().state).toBe('failed')
    expect(w.alerts.find(a => a.key === 'draft/finde-2026-11-20')!.text).toMatch(/preview couldn't be posted/)
    w.at('2026-11-20', 18, 10)
    await w.job().tick()
    expect(w.resolved).not.toContain('draft/finde-2026-11-20')
  })

  it("refuses to upload frames that don't match the saved revision", async () => {
    const w = await previewed()
    w.approve()
    writeFileSync(w.draft().frames[0]!, 'swapped')
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.r2).toEqual([])
    expect(w.ig.published).toHaveLength(0)
  })
})

describe('Este finde Reel', () => {
  /** Thursday 18:05: the Reel draft is previewed (the finde draft was made Wednesday). */
  async function reelPreviewed(w = new World()) {
    await w.job().tick()
    w.at('2026-11-19', 18, 5)
    await w.job().tick()
    expect(w.reel()!.state).toBe('previewed')
    return w
  }
  const approveReel = (w: World) => { w.reelReactions = [{ name: 'white_check_mark', users: [HANIF] }] }

  it('drafts Thursday 18:00 with the first never-published track and previews the video with the track named', async () => {
    const w = await reelPreviewed()
    const reel = w.reel()!
    expect(reel.track).toMatchObject({ id: 'a', title: 'Track a', artist: 'Synth' })
    expect(w.reelRenders).toHaveLength(1)
    expect(reel.frames.map(path => path.split('/').pop())).toEqual(['reel.mp4', 'cover.jpg'])
    const preview = w.slackPosts.find(post => post.text.startsWith('Instagram draft: Este finde Reel'))!
    expect(preview.text).toContain('It goes out Friday at 12:00 once you react ✅.')
    expect(preview.text.endsWith('\n\nMusic: "Track a" by Synth.')).toBe(true)
    expect(reel.caption).toBe(w.draft().caption)
  })

  it('shows the carousel picks minus the finde exclusions', async () => {
    const w = new World()
    await w.job().tick()
    w.at('2026-11-18', 19)
    await w.job().regenerate('finde-2026-11-20', [uuid(2)])
    w.at('2026-11-19', 18, 5)
    await w.job().tick()
    expect(w.reel()!.events.map(event => event.id)).not.toContain(uuid(2))
    expect(w.reel()!.events).toHaveLength(5)
  })

  it('skips with fewer than 4 events and never renders', async () => {
    const w = new World()
    w.catalog = w.catalog.slice(0, 3)
    w.at('2026-11-19', 18, 5)
    await w.job().tick()
    expect(w.reel()!.state).toBe('skipped')
    expect(w.reelRenders).toHaveLength(0)
    expect(w.slackPosts.map(post => post.text)).toContain('Instagram draft: Este finde Reel for November 20 to 22. Skipped: only 3 events qualified')
  })

  it('publishes at Friday 12:00 as a REELS container with the video and cover, after polling a slow container across ticks', async () => {
    const w = await reelPreviewed()
    approveReel(w)
    w.ig.reelStatus = 'IN_PROGRESS'
    w.at('2026-11-20', 12)
    await w.job().tick()
    expect(w.reel()!.state).toBe('publishing')
    expect(w.reel()!.publishFailures).toBe(0)
    expect(w.r2.filter(key => key.startsWith('instagram/reel-'))).toEqual([`instagram/reel-2026-11-20/${w.reel()!.framesHash}/reel.mp4`, `instagram/reel-2026-11-20/${w.reel()!.framesHash}/cover.jpg`])
    const container = [...w.ig.containers.values()].find(c => c.params.media_type === 'REELS')!
    expect(container.params).toEqual({
      media_type: 'REELS',
      video_url: `https://ig.example/instagram/reel-2026-11-20/${w.reel()!.framesHash}/reel.mp4`,
      cover_url: `https://ig.example/instagram/reel-2026-11-20/${w.reel()!.framesHash}/cover.jpg`,
      caption: w.reel()!.caption,
      share_to_feed: 'true',
    })
    w.ig.finishReels()
    w.at('2026-11-20', 12, 10)
    await w.job().tick()
    expect(w.reel()!.state).toBe('published')
    expect(w.ig.calls.filter(call => call === 'POST 17841/media')).toHaveLength(1)
    expect(w.ig.published.filter(media => w.ig.containers.get(media.container!)!.params.media_type === 'REELS')).toHaveLength(1)
  })

  it('publishes a late ✅ at once before Friday 18:00', async () => {
    const w = await reelPreviewed()
    w.at('2026-11-20', 15)
    await w.job().tick()
    expect(w.reel()!.state).toBe('previewed')
    approveReel(w)
    w.at('2026-11-20', 15, 10)
    await w.job().tick()
    expect(w.reel()!.state).toBe('published')
  })

  it('settles an unclear media_publish from the container instead of posting again', async () => {
    const w = await reelPreviewed()
    approveReel(w)
    w.ig.publishFault = 'after'
    w.at('2026-11-20', 12)
    await w.job().tick()
    expect(w.reel()!.publish!.units[0]!.pendingSince).not.toBeNull()
    w.at('2026-11-20', 12, 10)
    await w.job().tick()
    expect(w.reel()!.state).toBe('published')
    expect(w.ig.calls.filter(call => call === 'POST 17841/media_publish')).toHaveLength(1)
  })

  it('rotates to the track whose last published Reel is oldest, never-published first', async () => {
    const w = new World()
    const published = (from: string, track: string) => writeFileSync(join(w.dir, 'drafts', `reel-${from}.json`), JSON.stringify({ id: `reel-${from}`, format: 'reel', from, state: 'published', track: { id: track } }))
    await w.job().tick()
    published('2026-11-06', 'b')
    published('2026-11-13', 'a')
    expect(w.job().chooseTrack()).toBe('c')
    published('2026-10-30', 'c')
    expect(w.job().chooseTrack()).toBe('c')
    published('2026-10-23', 'c')
    published('2026-11-06', 'c')
    expect(w.job().chooseTrack()).toBe('b')
  })

  it('regenerate keeps the track unless --track names another', async () => {
    const w = await reelPreviewed()
    w.at('2026-11-19', 19)
    await w.job().regenerate('reel-2026-11-20', [uuid(3)])
    expect(w.reel()!.track!.id).toBe('a')
    expect(w.reel()!.events.map(event => event.id)).not.toContain(uuid(3))
    await w.job().regenerate('reel-2026-11-20', [], 'b')
    expect(w.reel()!.track!.id).toBe('b')
    expect(w.reel()!.exclude).toEqual([uuid(3)])
    expect(w.reelRenders.at(-1)!.track).toBe('b')
  })

  it('fails the draft with an alert, never a silent Reel, when its track is unmeasured or its file is missing', async () => {
    const w = new World()
    w.music = musicDir([{ id: 'x', bpm: null, startSec: null } as never])
    w.config.reel.musicDir = w.music
    w.at('2026-11-19', 18, 5)
    await w.job().tick()
    expect(w.reel()).toBeNull()
    expect(w.reelRenders).toHaveLength(0)
    expect(w.alerts.find(alert => alert.key === 'tick')!.text).toContain('reel-2026-11-20: Reel track x has no bpm and startSec yet')
    const { rmSync } = await import('node:fs')
    w.config.reel.musicDir = w.music = musicDir()
    rmSync(join(w.music, 'a.flac'))
    await w.job().tick()
    expect(w.alerts.at(-1)!.text).toContain('a.flac is missing')
    w.config.reel.musicDir = '/nonexistent/reel-music'
    await w.job().tick()
    expect(w.alerts.at(-1)!.text).toContain('tracks.json is missing')
  })
})
