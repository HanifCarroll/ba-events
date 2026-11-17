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
  slackPosts: Array<{ text: string; threadTs?: string }> = []
  /** Fail this many Slack replies whose text starts with the prefix. */
  slackFails = 0
  slackFailPrefix = ''
  alerts: Array<{ key: string; text: string }> = []
  r2: string[] = []
  config: Config = { auto: { hoy: false, finde: false, gratis: false }, r2: { bucket: 'b', publicBaseUrl: 'https://ig.example' } }
  renderCount = 0
  nextTs = 1

  services(): Services {
    return {
      stateDir: this.dir,
      repo: this.dir,
      now: () => new Date(this.clock),
      config: () => this.config,
      readCatalog: async (_window: RunWindow) => this.catalog,
      readEventStatuses: async ids => new Map(ids.map(id => [id, this.statuses.get(id) ?? 'scheduled'])),
      render: async (_html, outDir, _height) => {
        this.renderCount++
        const { mkdirSync } = await import('node:fs')
        mkdirSync(outDir, { recursive: true })
        return Array.from({ length: 8 }, (_, i) => { const path = join(outDir, `frame-${i + 1}.jpg`); writeFileSync(path, `render ${this.renderCount} frame ${i + 1}`); return path })
      },
      slackUploadFiles: async (frames, id) => frames.map((_, i) => ({ id: `F${id}-${this.renderCount}-${i}`, title: `${id}-${i}` })),
      slackShareFiles: async (_files, text) => { this.slackPosts.push({ text }) },
      slackShareTs: async () => `${this.nextTs++}.0`,
      slackPost: async (text, threadTs) => {
        if (this.slackFails > 0 && text.startsWith(this.slackFailPrefix)) { this.slackFails--; throw new Error('Slack chat.postMessage failed: ratelimited') }
        this.slackPosts.push({ text, threadTs })
        return { ts: `${this.nextTs++}.0` }
      },
      slackReactions: async () => this.reactions,
      r2Put: async (_bucket, key) => { this.r2.push(key) },
      loadToken: async () => ({ state: 'ok', token: { access_token: 'T', ig_user_id: '17841', expires_at: '2027-01-01T00:00:00.000Z' }, warning: null }),
      instagram: () => this.ig,
      alert: async (key, _title, text) => { this.alerts.push({ key, text }) },
      resolveAlert: async () => {},
      sleep: async () => {},
      log: () => {},
    }
  }

  job() { return new Job(this.services()) }
  at(date: string, hour: number, minute = 0) { this.clock = baInstant(date, hour, minute); this.ig.clock = this.clock.getTime() }
  approve() { this.reactions = [{ name: 'white_check_mark', users: [HANIF] }] }
  reject() { this.reactions = [{ name: 'x', users: [HANIF] }] }
  draft(): Draft { return JSON.parse(readFileSync(join(this.dir, 'drafts', 'finde-2026-11-20.json'), 'utf8')) }
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
    expect(w.replies()).toEqual(['Skipped: not published by 18:00'])
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
