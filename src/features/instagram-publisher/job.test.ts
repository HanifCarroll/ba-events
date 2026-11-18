/** Drives `tick` and `regenerate` through the draft lifecycle with fake Slack, D1, R2, rendering, and Instagram. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeFailure, TickFailures } from './alerts.ts'
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
  alerts: Array<{ key: string; text: string; fingerprint?: string }> = []
  openAlerts = new Map<string, string | undefined>()
  resolved: string[] = []
  logs: string[] = []
  recovery: Array<{ key: string; text: string }> = []
  r2: string[] = []
  music = musicDir()
  config: Config = { auto: { hoy: false, finde: false, gratis: false, reel: false }, r2: { bucket: 'b', publicBaseUrl: 'https://ig.example' }, reel: { musicDir: this.music } }
  reelRenders: Array<{ track: string; total: number; events: string[] }> = []
  renderError: Error | null = null
  tokenWarning: string | null = null
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
        if (this.renderError) throw this.renderError
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
      loadToken: async () => ({ state: 'ok', token: { access_token: 'T', ig_user_id: '17841', expires_at: '2027-01-01T00:00:00.000Z' }, warning: this.tokenWarning }),
      instagram: () => this.ig,
      alert: async (key, _title, text, fingerprint) => {
        const headline = text.split('\n').slice(0, 2).join('\n')
        expect(headline).not.toMatch(/journalctl|\/home\/|bun scripts|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
        if (!this.openAlerts.has(key) || this.openAlerts.get(key) !== (fingerprint ?? text)) this.alerts.push({ key, text, fingerprint })
        this.openAlerts.set(key, fingerprint ?? text)
      },
      resolveAlert: async (key, text) => {
        this.resolved.push(key)
        if (this.openAlerts.delete(key) && text) this.recovery.push({ key, text })
      },
      sleep: async () => {},
      log: message => { this.logs.push(message) },
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

describe('tick: preview alerts', () => {
  it('reconciles a new preview in the same tick without recording a failure', async () => {
    const w = new World()
    const job = w.job()
    let lookups = 0
    job.s.slackShareTs = async () => ++lookups === 1 ? null : '42.0'
    await job.tick()
    expect(w.draft()).toMatchObject({ state: 'previewed', slack: { ts: '42.0' } })
    expect(w.slackPosts).toHaveLength(1)
    expect(w.alerts).toEqual([])
    expect(w.logs).toContain('finde-2026-11-20: Slack preview lookup failed: the upload has no message yet')
    expect(() => readFileSync(join(w.dir, 'tick-failures.json'))).toThrow(/ENOENT/)
  })

  it('does not give a new skip notice a second attempt in the same tick', async () => {
    const w = new World()
    w.catalog = []
    w.slackFails = 1
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'skipped', notify: { failures: 1 } })
    expect(w.slackPosts).toHaveLength(0)
    w.at('2026-11-18', 18, 10)
    await w.job().tick()
    expect(w.draft().notify).toBeNull()
    expect(w.slackPosts).toHaveLength(1)
  })

  it.each(['{broken', 'null'])('quarantines a broken streak file (%s) without blocking a publish', async contents => {
    const w = await previewed()
    const file = join(w.dir, 'tick-failures.json')
    writeFileSync(file, contents)
    w.approve()
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.draft().state).toBe('published')
    expect(readFileSync(`${file}.bad-${w.clock.getTime()}`, 'utf8')).toBe(contents)
    expect(w.logs.some(log => log.includes('tick-failures.json'))).toBe(true)
  })
  it('logs one failed render without alerting, then clears the streak', async () => {
    const w = new World()
    w.renderError = new Error('Rendering failed (timed out):')
    await w.job().tick()
    expect(w.alerts).toEqual([])
    w.renderError = null
    w.at('2026-11-18', 18, 10)
    await w.job().tick()
    expect(w.draft().state).toBe('previewed')
    expect(w.alerts).toEqual([])
    expect(w.recovery).toEqual([])
    expect(w.logs).toContain('finde-2026-11-20: Rendering failed (timed out):')
    expect(JSON.parse(readFileSync(join(w.dir, 'tick-failures.json'), 'utf8'))).toEqual({})
  })

  it('alerts on the third failed render and names the recovered preview', async () => {
    const w = new World()
    w.renderError = Object.assign(new Error('Rendering failed (timed out):'), { availableMemoryMb: 450 })
    for (const minute of [0, 10, 20]) {
      w.at('2026-11-18', 18, minute)
      await w.job().tick()
      expect(w.alerts).toHaveLength(minute === 20 ? 1 : 0)
    }
    expect(w.alerts[0]).toMatchObject({ key: 'tick', text: [
      "🚨 *The Este finde carousel preview for Nov 20–22 hasn't reached Slack* (3 tries since 18:00). {triage}",
      'Building its images took longer than the 3-minute limit. The VPS was short on memory then (450 MB free). The publisher tries again at 18:30. The post is due Thu 12:00.',
      '`Rendering failed (timed out):` · 3rd failed try in a row · finde-2026-11-20',
    ].join('\n') })
    w.at('2026-11-18', 18, 30)
    w.renderError = Object.assign(new Error('Rendering failed (timed out): another diagnostic'), { availableMemoryMb: 438 })
    await w.job().tick()
    expect(w.alerts).toHaveLength(1)
    expect(JSON.parse(w.alerts[0]!.fingerprint!)).toEqual([['finde-2026-11-20', 'Building its images took longer than the 3-minute limit. The VPS was short on memory then.']])
    w.renderError = null
    w.at('2026-11-18', 18, 40)
    const job = w.job()
    const resolve = job.s.resolveAlert
    job.s.resolveAlert = async (key, text) => key === 'tick' ? false : resolve(key, text)
    await job.tick()
    expect(w.recovery).toEqual([])
    w.at('2026-11-18', 18, 50)
    await w.job().tick()
    expect(w.recovery).toContainEqual({ key: 'tick', text: '✅ *Instagram publisher recovered* at 18:50: the Este finde carousel preview for Nov 20–22 is in #ba-eventos.' })
  })

  it('closes a legacy tick alert even without a recorded streak', async () => {
    const w = new World()
    w.openAlerts.set('tick', 'old alert')
    await w.job().tick()
    expect(w.recovery).toContainEqual({ key: 'tick', text: '✅ *Instagram publisher recovered* at 18:05: the latest tick finished without errors.' })
  })

  it('alerts on the first failed render when the preview is an hour late', async () => {
    const w = new World()
    w.renderError = new Error('Rendering failed: test')
    w.at('2026-11-18', 19)
    await w.job().tick()
    expect(w.alerts).toHaveLength(1)
    expect(w.alerts[0]!.text).toContain('1st failed try in a row')
  })

  it('groups late previews, keeps the oldest first, and updates when the cause changes', async () => {
    const w = new World()
    w.renderError = new Error('Rendering failed: render test')
    w.at('2026-11-18', 19)
    await w.job().tick()
    w.at('2026-11-20', 12)
    await w.job().tick()
    const grouped = w.alerts[1]!
    expect(grouped.text).toContain("Este finde carousel preview for Nov 20–22 hasn't reached Slack")
    expect(grouped.text.split('\n')[2]).toBe('Also failing: the Hoy story for Nov 20 (1 tries).')
    expect(JSON.parse(grouped.fingerprint!)).toEqual([
      ['finde-2026-11-20', 'Building its images failed.'],
      ['hoy-2026-11-20', 'Building its images failed.'],
    ])
    w.renderError = new Error('Rendering failed (timed out): test')
    w.at('2026-11-20', 12, 10)
    await w.job().tick()
    expect(w.alerts).toHaveLength(3)
    expect(w.alerts[2]!.text).toContain('Building its images took longer than the 3-minute limit. The publisher tries again')
  })

  it('closes a tick alert with the actual skipped outcome, not a recovery', async () => {
    const w = await previewed()
    const job = w.job()
    job.s.slackReactions = async () => { throw new Error('Slack reactions.get failed: ratelimited') }
    for (const minute of [10, 20, 30]) {
      w.at('2026-11-18', 18, minute)
      await job.tick()
    }
    expect(w.alerts[0]?.key).toBe('tick')
    w.reject()
    w.at('2026-11-18', 18, 40)
    await w.job().tick()
    expect(w.recovery[0]).toMatchObject({ key: 'tick', text: expect.stringMatching(/^⚠️ .*the Este finde carousel for Nov 20–22 was skipped\.$/) })
  })

  it('reports a missed cutoff without claiming a render that never created a draft recovered', async () => {
    const w = new World()
    w.renderError = new Error('Rendering failed (timed out):')
    w.at('2026-11-18', 19)
    await w.job().tick()
    w.at('2026-11-20', 18)
    await w.job().tick()
    expect(w.alerts.find(alert => alert.key === 'draft/finde-2026-11-20')?.text).toContain('preview never reached Slack')
    expect(w.recovery).toContainEqual({ key: 'tick', text: "⚠️ *Instagram publisher stopped retrying* at 18:00: the Este finde carousel for Nov 20–22 didn't get a preview before cutoff." })
  })
})

it('formats a token expiry warning in Buenos Aires time and resolves when it clears', async () => {
  const w = new World()
  w.tokenWarning = 'The Instagram token expires in 1 days (2026-11-19T21:00:00.000Z).'
  await w.job().tick()
  expect(w.alerts[0]).toMatchObject({ key: 'token', text: '⚠️ *The Instagram token needs attention*. {triage}\nThe Instagram token expires in 1 days (Thu 18:00).' })
  w.tokenWarning = null
  w.at('2026-11-18', 18, 10)
  await w.job().tick()
  expect(w.recovery).toContainEqual({ key: 'token', text: '✅ *The Instagram token is working again* at 18:10.' })
})

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

  it('alerts on the third publishing failure and updates the alert when the sixth gives up', async () => {
    const w = await previewed()
    w.approve()
    w.ig.quotaUsage = 50
    for (const minute of [0, 10, 20, 30, 40, 50]) {
      w.at('2026-11-19', 12, minute)
      await w.job().tick()
      expect(w.alerts).toHaveLength(minute < 20 ? 0 : minute < 50 ? 1 : 2)
    }
    expect(w.alerts[0]!.text).toBe([
      "🚨 *The Este finde carousel for Nov 20–22 hasn't published yet* (3 tries since 12:00). {triage}",
      'Instagram returned an error. It tries again at 12:30. The last chance is Fri 18:00.',
      '`publishing limit reached (50/50 in 24 hours)` · 3rd failed try in a row · finde-2026-11-20',
    ].join('\n'))
    expect(w.alerts[1]!.text).toContain("didn't publish*: the publisher gave up after 6 tries at 12:50. {triage}")
    expect(w.alerts[1]!.text).toContain("Nothing went out on Instagram, and the publisher won't try again.")
    expect(w.draft().state).toBe('failed')
  })

  it('alerts on the third failed tick across reactions and uploads, without spending the publish budget on reaction reads', async () => {
    const w = await previewed()
    w.approve()
    for (const minute of [0, 10, 20, 30]) {
      w.at('2026-11-19', 12, minute)
      const job = w.job()
      if (minute === 0 || minute === 30) job.s.slackReactions = async () => { throw new Error('Slack reactions.get failed: ratelimited') }
      else job.s.r2Put = async () => { throw new Error('R2 upload failed: HTTP 503') }
      await job.tick()
      expect(w.alerts).toHaveLength(minute < 20 ? 0 : minute === 20 ? 1 : 2)
    }
    expect(w.draft().publishFailures).toBe(2)
    expect(w.alerts.map(alert => alert.key)).toEqual(['draft/finde-2026-11-20', 'draft/finde-2026-11-20'])
    expect(w.alerts[0]!.text).toContain('3rd failed try in a row')
    expect(w.alerts[1]!.text).toContain('4th failed try in a row')
  })

  it('updates the publish alert when an unchanged network cause leaves the post outcome unclear', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-20', 17, 10)
    const job = w.job()
    job.s.r2Put = async () => { throw new Error('fetch failed') }
    await job.tick()
    expect(w.alerts[0]!.text).toContain("hasn't published yet")
    w.ig.publishFault = 'before'
    w.at('2026-11-20', 17, 20)
    await w.job().tick()
    expect(w.alerts).toHaveLength(2)
    expect(w.alerts[1]!.text).toContain("hasn't confirmed whether")
  })

  it('alerts on the first failure less than an hour before the deadline and resolves on publish', async () => {
    const w = await previewed()
    w.approve()
    w.ig.quotaUsage = 50
    w.at('2026-11-20', 17, 10)
    await w.job().tick()
    expect(w.alerts[0]!.text).toContain('1st failed try in a row')
    w.ig.quotaUsage = 0
    w.at('2026-11-20', 17, 20)
    await w.job().tick()
    expect(w.recovery).toContainEqual({ key: 'draft/finde-2026-11-20', text: `✅ *The Este finde carousel for Nov 20–22 is on Instagram* at 17:20: ${w.draft().publish!.permalink}` })
    expect(JSON.parse(readFileSync(join(w.dir, 'tick-failures.json'), 'utf8'))).toEqual({})
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
    expect(w.alerts[0]!.text).toContain("hasn't confirmed whether the Este finde carousel for Nov 20–22 went out")
    w.at('2026-11-20', 18, 30) // past Friday 18:00
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
    expect(w.draft().state).toBe('published')
  })

  it('updates and closes a shared tick alert truthfully when a live post exhausts its link retries', async () => {
    const w = await previewed()
    w.approve()
    const job = w.job()
    job.s.slackReactions = async () => { throw new Error('fetch failed') }
    for (const minute of [0, 10, 20]) {
      w.at('2026-11-19', 12, minute)
      await job.tick()
    }
    expect(w.alerts.map(alert => alert.key)).toEqual(['tick'])

    const get = w.ig.get.bind(w.ig)
    w.ig.get = async (path, params) => {
      if (params?.fields === 'permalink') throw new Error('fetch failed')
      return get(path, params)
    }
    w.at('2026-11-19', 12, 30)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
    expect(w.alerts[1]).toMatchObject({ key: 'tick', text: expect.stringContaining('is on Instagram') })
    expect(w.alerts[1]!.text).toContain('It tries again at 12:40 to find the link.')

    for (const [hour, minute] of [[12, 40], [12, 50], [13, 0], [13, 10], [13, 20]]) {
      w.at('2026-11-19', hour, minute)
      await w.job().tick()
    }
    expect(w.draft().state).toBe('failed')
    expect(w.ig.published).toHaveLength(1)
    expect(w.alerts.at(-1)).toMatchObject({ key: 'draft/finde-2026-11-20', text: expect.stringContaining('is on Instagram') })
    expect(w.recovery.find(reply => reply.key === 'tick')?.text).toBe("⚠️ *Instagram publisher stopped retrying* at 13:20: the Este finde carousel for Nov 20–22 is on Instagram, but the publisher couldn't get its link.")
  })

  it('does not say a post failed to publish when only the link lookup failed', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-20', 17, 10)
    const get = w.ig.get.bind(w.ig)
    w.ig.get = async (path, params) => {
      if (params?.fields === 'permalink') throw new Error('fetch failed')
      return get(path, params)
    }
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
    expect(w.alerts[0]!.text).toContain("is on Instagram, but the publisher hasn't found its link")
  })

  it('reports a story that stops after one frame without posting the rest', async () => {
    const w = new World()
    const job = w.job()
    w.at('2026-11-20', 11)
    const draft = await job.createDraft('hoy', '2026-11-20', [], 1)
    w.at('2026-11-20', 17)
    job.s.slackReactions = async () => [{ name: w.ig.published.length ? 'x' : 'white_check_mark', users: [HANIF] }]
    await job.advance(draft, new TickFailures(job.s))
    expect(w.ig.published).toHaveLength(1)
    expect(w.alerts[0]).toMatchObject({ key: 'draft/hoy-2026-11-20', text: [
      '🚨 *The Hoy story for Nov 20 stopped part-way*: 1 of 8 frames went out. {triage}',
      'Hanif reacted ❌. Nothing more will be posted for it.',
      `hoy-2026-11-20 · state ${job.draftFile(draft.id)}`,
    ].join('\n') })
  })

  it('skips an approved draft that could not go out before the deadline', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-20', 17, 50)
    w.ig.quotaUsage = 50
    await w.job().tick()
    expect(w.alerts[0]!.text).toContain('There is no retry before the 18:00 deadline.')
    w.ig.quotaUsage = 0
    w.at('2026-11-20', 18)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    // The Reel, drafted Thursday with no ✅, is skipped at the same moment in its own thread.
    expect(w.slackPosts.filter(post => post.threadTs === w.draft().slack.ts).map(post => post.text)).toEqual(['Skipped: not published by 18:00'])
    expect(w.recovery[0]!.text).toContain("wasn't posted*: its deadline passed at 18:00.")
  })

  it('closes a retry alert when approval is withdrawn before cutoff', async () => {
    const w = await previewed()
    w.approve()
    w.at('2026-11-20', 17, 10)
    const job = w.job()
    job.s.r2Put = async () => { throw new Error('R2 upload failed: HTTP 503') }
    await job.tick()
    expect(w.draft().state).toBe('previewed')
    expect(w.alerts).toHaveLength(1)
    w.reactions = []
    w.at('2026-11-20', 18)
    await w.job().tick()
    expect(w.draft().state).toBe('skipped')
    expect(w.recovery[0]!.text).toContain("it didn't have a ✅ by 18:00.")
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
    const alert = w.alerts.find(a => a.key === 'draft/finde-2026-11-20' && a.text.includes('is on hold'))!
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
    w.slackFails = 3
    w.slackFailPrefix = 'Posted:'
    for (const minute of [0, 10, 20]) {
      w.at('2026-11-19', 12, minute)
      await w.job().tick()
      expect(w.draft().state).toBe('published')
      expect(w.draft().notify?.text).toMatch(/^Posted: /)
      expect(w.alerts).toHaveLength(minute === 20 ? 1 : 0)
    }
    const key = 'draft/finde-2026-11-20/slack'
    expect(w.alerts[0]).toMatchObject({ key, text: [
      "⚠️ *The Este finde carousel for Nov 20–22 is on Instagram, but its Slack reply didn't go through*. No action needed.",
      `The publisher retries the reply at 12:30. The post: ${w.draft().publish!.permalink}`,
      '`Slack chat.postMessage failed: ratelimited` · 3rd failed try in a row · finde-2026-11-20',
    ].join('\n') })
    w.at('2026-11-19', 12, 30)
    await w.job().tick()
    expect(w.draft().notify).toBeNull()
    expect(w.recovery).toContainEqual({ key, text: '✅ *The Slack reply for the Este finde carousel for Nov 20–22 went through* at 12:30.' })
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
    expect(alert.text).toContain("Rebuilding the Este finde carousel for Nov 20–22 didn't finish")
    expect(alert.text).toContain(`regenerate finde-2026-11-20 --exclude ${uuid(2)}`)
    // A later tick that succeeds doesn't clear the draft's alert.
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.resolved).not.toContain('draft/finde-2026-11-20')
  })

  it('leaves an interrupted rebuild unretried and drops the rebuild command after cutoff', async () => {
    const w = await previewed()
    const job = w.job()
    job.s.render = async () => { throw new Error('render crashed') }
    await expect(job.regenerate('finde-2026-11-20', [])).rejects.toThrow('render crashed')
    expect(w.draft().state).toBe('rebuilding')
    w.at('2026-11-20', 18)
    await w.job().tick()
    expect(w.draft().state).toBe('failed')
    expect(w.renderCount).toBe(1)
    expect(w.alerts.find(a => a.key === 'draft/finde-2026-11-20')!.text).toBe([
      "🚨 *Rebuilding the Este finde carousel for Nov 20–22 didn't finish*. No action needed.",
      "It's past its 18:00 cutoff, so this one is lost. Nothing was posted.",
      'finde-2026-11-20',
    ].join('\n'))
  })

  it('reconciles a rebuilt preview when Slack took the upload but the lookup failed', async () => {
    const w = await previewed()
    const job = w.job()
    job.s.slackShareTs = async () => null
    await expect(job.regenerate('finde-2026-11-20', [])).rejects.toThrow('Slack preview lookup failed')
    expect(w.draft().state).toBe('previewing')
    expect(w.slackPosts).toHaveLength(2)
    w.at('2026-11-18', 18, 10)
    await w.job().tick()
    expect(w.draft().state).toBe('previewed')
    expect(w.slackPosts).toHaveLength(2)
    expect(w.alerts).toEqual([])
  })

  it('alerts when the preview never reached Slack before the cutoff', async () => {
    const w = new World()
    const job = w.job()
    ;(job.s as { slackShareTs: Services['slackShareTs'] }).slackShareTs = async () => null
    await job.tick() // uploaded, but Slack never reports the message
    expect(w.draft().state).toBe('previewing')
    const streaks = JSON.parse(readFileSync(join(w.dir, 'tick-failures.json'), 'utf8'))
    expect(streaks[w.draft().id].count).toBe(1)
    w.at('2026-11-20', 18)
    await w.job().tick()
    expect(w.draft().state).toBe('failed')
    const alert = w.alerts.find(a => a.key === 'draft/finde-2026-11-20')!
    expect(alert.text).toContain('its preview never reached Slack before the 18:00 cutoff')
    expect(alert.text.split('\n')[2]).toBe('`Slack preview lookup failed: the upload has no message yet` · finde-2026-11-20')
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

  it('logs each unusable track failure and alerts without rendering a silent Reel', async () => {
    const w = new World()
    w.music = musicDir([{ id: 'x', bpm: null, startSec: null } as never])
    w.config.reel.musicDir = w.music
    w.at('2026-11-19', 18, 5)
    await w.job().tick()
    expect(w.reel()).toBeNull()
    expect(w.reelRenders).toHaveLength(0)
    expect(w.logs).toContainEqual(expect.stringContaining('reel-2026-11-20: Reel track x has no bpm and startSec yet'))
    const { rmSync } = await import('node:fs')
    w.config.reel.musicDir = w.music = musicDir()
    rmSync(join(w.music, 'a.flac'))
    w.at('2026-11-19', 18, 10)
    await w.job().tick()
    expect(w.logs.some(log => log.includes('a.flac is missing'))).toBe(true)
    expect(w.alerts).toEqual([])
    w.config.reel.musicDir = '/nonexistent/reel-music'
    w.at('2026-11-19', 18, 20)
    await w.job().tick()
    expect(w.reelRenders).toHaveLength(0)
    expect(w.alerts[0]!.text).toContain('tracks.json is missing')
    expect(w.alerts[0]!.text).toContain('3rd failed try in a row')
  })

  it.each([
    'Rendering the Reel failed (exit 1): test',
    'Remuxing the Reel failed: test',
    'Extracting the Reel cover failed: test',
    "The rendered Reel isn't the expected 1080 × 1920 H.264/AAC at 30 fps",
  ])('uses the plain video cause for %s', message => {
    expect(describeFailure(new Error(message)).cause).toBe('Building its video failed.')
  })

  it('uses the video time limit and measured memory in a Reel render timeout alert', async () => {
    const w = new World()
    const job = w.job()
    job.s.renderReel = async () => { throw Object.assign(new Error('Rendering the Reel failed (timed out):'), { availableMemoryMb: 450 }) }
    for (const minute of [0, 10, 20]) {
      w.at('2026-11-19', 18, minute)
      await job.tick()
      expect(w.alerts).toHaveLength(minute === 20 ? 1 : 0)
    }
    expect(w.alerts[0]!.text).toContain("The Este finde Reel preview for Nov 20–22 hasn't reached Slack")
    expect(w.alerts[0]!.text).toContain('3rd failed try in a row')
    expect(w.alerts[0]!.text).toContain('Building its video took longer than the 10-minute limit. The VPS was short on memory then (450 MB free).')
  })
})

describe('Este finde Reel: Friday daytime events', () => {
  /** The carousel picks three Friday daytime events without an end time, as on 2026-11-20. */
  function daytime() {
    const w = new World()
    w.catalog = [...w.catalog.slice(3), ...[12, 13, 14].map((hour, i) => ({ ...w.catalog[i]!, startsAt: baInstant('2026-11-20', hour).toISOString() }))]
    return w
  }

  it('leaves them out, so neither the slot nor a late ✅ before the deadline is held', async () => {
    for (const [hour, minute] of [[12, 0], [17, 50]] as const) {
      const w = daytime()
      w.catalog.push(...[4, 5, 6].map(n => ({ ...w.catalog[0]!, id: uuid(n + 10), venue: `Otra sala ${n}`, startsAt: baInstant('2026-11-21', 20 + (n % 3)).toISOString() })))
      await w.job().tick()
      expect(w.draft().events.map(event => event.id)).toEqual(expect.arrayContaining([uuid(1), uuid(2), uuid(3)]))
      w.at('2026-11-19', 18, 5)
      await w.job().tick()
      const reel = w.reel()!
      expect(reel.events.map(event => event.id).filter(id => [uuid(1), uuid(2), uuid(3)].includes(id))).toEqual([])
      w.reelReactions = [{ name: 'white_check_mark', users: [HANIF] }]
      w.at('2026-11-20', hour, minute)
      await w.job().tick()
      expect(w.reel()!.state).toBe('published')
    }
  })
})

describe('Este finde Reel: a container that never finishes processing', () => {
  async function stuck() {
    const w = new World()
    await w.job().tick()
    w.at('2026-11-19', 18, 5)
    await w.job().tick()
    w.reelReactions = [{ name: 'white_check_mark', users: [HANIF] }]
    w.ig.reelStatus = 'IN_PROGRESS'
    w.at('2026-11-20', 12)
    await w.job().tick()
    expect(w.reel()!.state).toBe('publishing')
    expect(w.reel()!.publish!.units[0]!.containerId).not.toBeNull()
    return w
  }
  const polls = (w: World) => w.ig.calls.filter(call => /^GET c\d+$/.test(call)).length

  it('stops polling and skips on ❌', async () => {
    const w = await stuck()
    w.reelReactions = [{ name: 'x', users: [HANIF] }]
    const before = polls(w)
    w.at('2026-11-20', 12, 10)
    await w.job().tick()
    expect(polls(w)).toBe(before)
    expect(w.reel()!.state).toBe('skipped')
    expect(w.slackPosts.filter(post => post.threadTs === w.reel()!.slack.ts).map(post => post.text)).toEqual(['Skipped: you reacted ❌'])
  })

  it('pauses without polling while the ✅ is removed', async () => {
    const w = await stuck()
    w.reelReactions = []
    const before = polls(w)
    w.at('2026-11-20', 12, 10)
    await w.job().tick()
    expect(polls(w)).toBe(before)
    expect(w.reel()!.state).toBe('publishing')
  })

  it('ends at the deadline with the "not published by" reply', async () => {
    const w = await stuck()
    const before = polls(w)
    w.at('2026-11-20', 18)
    await w.job().tick()
    expect(polls(w)).toBe(before)
    expect(w.reel()!.state).toBe('skipped')
    expect(w.slackPosts.filter(post => post.threadTs === w.reel()!.slack.ts).map(post => post.text)).toEqual(['Skipped: not published by 18:00'])
    expect(w.ig.published).toHaveLength(0)
  })
})

describe('Este finde Reel: recovering a failed track-only regenerate', () => {
  it('saves the requested track and names it in the recovery command', async () => {
    const w = new World()
    await w.job().tick()
    w.at('2026-11-19', 18, 5)
    await w.job().tick()
    w.at('2026-11-19', 19)
    const job = w.job()
    const services = job.s as { renderReel: unknown }
    services.renderReel = async () => { throw new Error('render crashed') }
    await expect(job.regenerate('reel-2026-11-20', [], 'b')).rejects.toThrow(/render crashed/)
    expect(w.reel()!.state).toBe('rebuilding')
    expect(w.reel()!.track!.id).toBe('b')
    w.at('2026-11-19', 19, 10)
    await w.job().tick()
    const alert = w.alerts.find(a => a.key === 'draft/reel-2026-11-20')!
    expect(alert.text).toContain('regenerate reel-2026-11-20 --track b')
  })
})
