/** Drives `tick` and `regenerate` through the draft lifecycle with fake Slack, D1, R2, rendering, and Instagram. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { describeFailure, TickFailures } from './alerts.ts'
import { HANIF } from './approval.ts'
import { FakeInstagram } from './fake-instagram.ts'
import { FakeThreads } from './fake-threads.ts'
import { addDays, baInstant } from './format.ts'
import type { RunWindow } from './formats.ts'
import { LAYOUT_VERSION } from './html.ts'
import type { Finding, InvestigationRequest } from './investigation.ts'
import { Job, dryRun, type Draft, type Services } from './job.ts'
import { DEFAULT_REVIEW, SlackRejected, withLock, type Config } from './runtime.ts'
import { OK, type Reviewer, type Verdict } from './review.ts'
import { resolveReviewQuestionsWithOpenAI } from './review-resolution.ts'
import type { CatalogEvent } from './select.ts'
import { StoryComposerError, type ComposeStory, type StickerFrame } from './story-stickers.ts'
import { threadsApi } from './threads-api.ts'
import { threadsReport } from './threads-report.ts'

/** A music directory with three synthetic tracks (the files only need to exist; the fake render never reads them). */
function musicDir(tracks = [{ id: 'a', bpm: 90, startSec: 1 }, { id: 'b', bpm: 120, startSec: 2 }, { id: 'c', bpm: 100, startSec: 0 }]) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-music-'))
  writeFileSync(join(dir, 'tracks.json'), JSON.stringify({ tracks: tracks.map(t => ({ title: `Track ${t.id}`, artist: 'Synth', file: `${t.id}.flac`, durationSec: 60, credit: null, ...t })) }))
  for (const t of tracks) writeFileSync(join(dir, `${t.id}.flac`), 'synthetic')
  return dir
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const modelResponse = (result: object) => Response.json({ status: 'completed', model: 'fake-vision', output: [
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] },
] })
const resolverResponse = (resolved: unknown[], selections: unknown[] = []) => modelResponse({ resolved, selections })
const selection = (id: string, quotes: Array<{ url: string; quote: string }>, address?: { url: string; quote: string; street: string; number: string }) => ({
  id, topic: address ? 'barrio' : 'other', quotes, addresses: address ? [{ ...address, role: 'performance_venue' }] : [], conflictingAddresses: false,
})

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
  imageUrl: `https://imagenes.passline.com/eventos/${i + 1}.jpg`,
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
  threads = new FakeThreads()
  threadsTokenReads = 0
  threadsConnections = 0
  threadsWarning: string | null = null
  catalog = weekend()
  statuses = new Map<string, string>()
  notInScope = new Set<string>()
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
  config: Config = { auto: { hoy: false, finde: false, gratis: false, reel: false }, slack: { channel: 'C0CG3EGKKP1' }, linkStickers: { hoy: false }, threads: { enabled: false, auto: { hoy: false, finde: false, gratis: false } }, r2: { bucket: 'b', publicBaseUrl: 'https://ig.example' }, reel: { musicDir: this.music }, review: DEFAULT_REVIEW }
  slackCalls: Array<{ method: string; channel?: string; text?: string; ts?: string; reply_broadcast?: true }> = []
  reviewPosts: Array<{ text: string; threadTs?: string }> = []
  loseBroadcastResponse = false
  reviewCalls = 0
  investigator?: Services['investigator']
  verdict: (id: string) => Verdict = () => OK
  reviewer: Reviewer = async input => {
    this.reviewCalls++
    return { model: 'fake-vision', post: OK, events: input.events.map(event => ({ id: event.id, ...this.verdict(event.id) })) }
  }
  composeStory: ComposeStory = async () => { throw new Error('Unexpected call to the browser') }
  reelRenders: Array<{ track: string; total: number; events: string[]; flyers: number }> = []
  /** The page the last still-frame render got, and every directory the flyers were downloaded into. */
  html = ''
  artDirs: string[] = []
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
        return [id, { status: this.statuses.get(id) ?? 'scheduled', startsAt: event.startsAt, endsAt: event.endsAt, inScope: !this.notInScope.has(id) }]
      })),
      artwork: async (events, dir) => {
        const { mkdirSync } = await import('node:fs')
        mkdirSync(dir, { recursive: true })
        this.artDirs.push(dir)
        return Object.fromEntries(events.filter(event => event.artworkRef).map(event => {
          const file = join(dir, `${event.id}.jpg`)
          writeFileSync(file, 'flyer')
          return [event.id, { file, backdrop: file, width: 800, height: 1000 }]
        }))
      },
      render: async (html, outDir, _height) => {
        this.html = html
        this.renderCount++
        if (this.renderError) throw this.renderError
        const { mkdirSync } = await import('node:fs')
        mkdirSync(outDir, { recursive: true })
        return Array.from({ length: 8 }, (_, i) => { const path = join(outDir, `frame-${i + 1}.jpg`); writeFileSync(path, `render ${this.renderCount} frame ${i + 1}`); return path })
      },
      renderReel: async (_window, events, timing, track, outDir, artwork) => {
        this.renderCount++
        this.reelRenders.push({ track: track.id, total: timing.total, events: events.map(event => event.id), flyers: Object.keys(artwork).length })
        const { mkdirSync } = await import('node:fs')
        mkdirSync(outDir, { recursive: true })
        return ['reel.mp4', 'cover.jpg'].map(name => { const path = join(outDir, name); writeFileSync(path, `render ${this.renderCount} ${name}`); return path })
      },
      slackUploadFiles: async (frames, id) => frames.map((_, i) => {
        this.slackCalls.push({ method: 'files.getUploadURLExternal' }, { method: 'POST upload URL' })
        return { id: `F${id}-${this.renderCount}-${i}`, title: `${id}-${i}` }
      }),
      slackShareFiles: async (_files, text, channel) => {
        this.slackCalls.push({ method: 'files.completeUploadExternal', channel, text })
        this.slackPosts.push({ text })
      },
      slackShareTs: async (_file, channel) => {
        this.slackCalls.push({ method: 'files.info', channel })
        return `${this.nextTs++}.0`
      },
      review: (...args) => this.reviewer(...args),
      reviewResources: async ids => new Map(ids.map(id => [id, { address: null, observations: [], officialPages: [] }])),
      fetchUsig: async () => { throw new Error('Unexpected USIG fetch') },
      investigator: this.investigator,
      slackPost: async (text: string, threadTs: string | null, channel: string, broadcast?: boolean) => {
        this.slackCalls.push({ method: 'chat.postMessage', channel, text, ...(threadTs ? { ts: threadTs } : {}), ...(broadcast ? { reply_broadcast: true } : {}) })
        if (broadcast && this.loseBroadcastResponse) throw new Error('Lost Slack response after posting')
        if (this.slackFails > 0 && text.startsWith(this.slackFailPrefix)) { this.slackFails--; throw new SlackRejected('Slack chat.postMessage failed: ratelimited') }
        if (/^Revis(?:ado|ión):/.test(text)) { this.reviewPosts.push({ text, threadTs: threadTs ?? undefined }); return { ts: 'review' } }
        this.slackPosts.push({ text, threadTs: threadTs ?? undefined })
        return { ts: `${this.nextTs++}.0` }
      },
      slackReviewReceipt: async () => { throw new Error('Unexpected Slack receipt lookup') },
      slackPermalink: async (ts: string, channel: string) => {
        this.slackCalls.push({ method: 'chat.getPermalink', ts, channel })
        return `https://test-workspace.slack.com/archives/${channel}/p${ts.replace('.', '')}`
      },
      slackReactions: async (ts, channel) => {
        this.slackCalls.push({ method: 'reactions.get', channel, ts })
        return ts === this.reel()?.slack.ts ? this.reelReactions : this.reactions
      },
      r2Put: async (_bucket, key) => { this.r2.push(key) },
      loadToken: async () => ({ state: 'ok', token: { access_token: 'T', ig_user_id: '17841', expires_at: '2027-01-01T00:00:00.000Z' }, warning: this.tokenWarning }),
      instagram: () => this.ig,
      loadThreadsToken: async () => {
        this.threadsTokenReads++
        return { accessToken: 'fake-threads-token', warning: this.threadsWarning }
      },
      threads: async () => { this.threadsConnections++; return this.threads },
      composeStory: (...args) => this.composeStory(...args),
      alert: async (key, _title, text, fingerprint) => {
        const headline = text.split('\n').slice(0, 2).join('\n')
        expect(headline).not.toMatch(/journalctl|\/home\/|bun scripts|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
        if (!this.openAlerts.has(key) || this.openAlerts.get(key) !== (fingerprint ?? text)) this.alerts.push({ key, text, fingerprint })
        this.openAlerts.set(key, fingerprint ?? text)
        return true
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
  at(date: string, hour: number, minute = 0) { this.clock = baInstant(date, hour, minute); this.ig.clock = this.threads.clock = this.clock.getTime() }
  approve() { this.reactions = [{ name: 'white_check_mark', users: [HANIF] }] }
  reject() { this.reactions = [{ name: 'x', users: [HANIF] }] }
  draft(): Draft { return JSON.parse(readFileSync(join(this.dir, 'drafts', 'finde-2026-11-20.json'), 'utf8')) }
  reel(id = 'reel-2026-11-20'): Draft | null {
    try { return JSON.parse(readFileSync(join(this.dir, 'drafts', `${id}.json`), 'utf8')) } catch { return null }
  }
  replies() { return this.slackPosts.filter(post => post.threadTs).map(post => post.text) }
  broadcasts() { return this.slackCalls.filter(call => call.reply_broadcast) }
}

async function previewed() {
  const w = new World()
  await w.job().tick() // Wednesday 18:05: the Este finde draft is previewed
  expect(w.draft().state).toBe('previewed')
  return w
}

describe('tick: draft review', () => {
  const badId = uuid(1)
  const wrong: Verdict = { verdict: 'wrong', field: 'summary', reason: 'The Teatro físico flyer is for a performance, not dog training.', question: null }
  const question = { verdict: 'question', field: null, reason: null, question: 'Is 21:00 the show time or the doors time?' } satisfies Verdict
  const postWrong = { verdict: 'wrong', field: 'date', reason: 'The cover dates do not match the selected events.', question: null } satisfies Verdict
  const world = () => {
    const w = new World()
    w.config.auto.finde = true
    w.config.threads.enabled = true
    w.config.threads.auto.finde = true
    Object.assign(w.catalog[0]!, { name: '18 mundos — Montaje anual', venue: 'Café Artigas', summary: 'Entrenamiento canino unipersonal para fortalecer la obediencia con tu perro.' })
    return w
  }
  const slot = (w: World) => w.at('2026-11-19', 12)

  it('saves one review and auto-publishes both channels without any Slack calls', async () => {
    const w = world()
    await w.job().tick()
    const draft = w.draft()
    expect(draft.review?.result).toMatchObject({ revision: 1, framesHash: draft.framesHash, model: 'fake-vision' })
    expect(draft.slack.ts).toBeNull()
    slot(w)
    await w.job().tick()
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'published' } })
    expect(w.reviewCalls).toBe(1)
    expect(w.slackCalls).toEqual([])
  })

  it.each(['cutoff', 'rebuild', 'manual Threads'] as const)('routes a confirmed post error to Hermes (%s)', async outcome => {
    const w = world()
    const review = w.reviewer
    w.reviewer = async input => ({ ...(await review(input)), post: postWrong })
    if (outcome === 'manual Threads') w.config.threads.auto.finde = false
    await w.job().tick()
    const draft = w.draft()
    expect(draft).toMatchObject({ revision: 1, state: 'previewed' })
    expect(w.alerts).toEqual([expect.objectContaining({ key: `draft/${draft.id}/review-fix`, text: expect.stringContaining(postWrong.reason) })])
    if (outcome === 'manual Threads') {
      expect(draft.slack.previews).toEqual([expect.objectContaining({ instagram: false, threads: true })])
      w.approve()
    } else expect(w.slackCalls).toEqual([])

    if (outcome === 'rebuild') {
      w.catalog[0]!.startsAt = baInstant('2026-11-22', 19).toISOString()
      w.reviewer = review
      await w.job().regenerate(draft.id, [])
    }
    slot(w)
    await w.job().tick()
    if (outcome === 'rebuild') {
      expect(w.draft()).toMatchObject({ revision: 2, state: 'published', threads: { state: 'published' } })
      expect(w.reviewCalls).toBe(2)
      expect(w.slackCalls).toEqual([])
    } else {
      expect(w.ig.published).toEqual([])
      if (outcome === 'cutoff') {
        expect(w.threads.posts).toEqual([])
        w.at('2026-11-20', 18)
        await w.job().tick()
        expect(w.draft()).toMatchObject({ revision: 1, state: 'skipped', threads: { state: 'skipped' } })
        expect(w.slackCalls).toEqual([])
      } else expect(w.threads.posts).toHaveLength(1)
    }
  })

  it.each(['question', 'wrong'] as const)('puts public evidence in the real quick-review %s reply', async verdict => {
    const w = world()
    w.config.auto.finde = false
    w.verdict = id => id === badId ? (verdict === 'question' ? question : wrong) : OK
    const postUrl = 'https://www.instagram.com/p/synthetic-review/'
    const url = 'https://sala.example.org/programa?funcion=1&dia=viernes'
    const excerpt = 'Función de *teatro físico* <@U123> & muestra.'
    const job = w.job()
    job.s.reviewResources = async () => new Map([[badId, { address: null,
      observations: [{ postUrl, caption: '', publishedAt: null, excerpts: [{ fields: ['description', 'time'], excerpt }] }],
      officialPages: [{ url, fields: ['description', 'time'], excerpt: 'Show 21:00 · teatro físico' },
        { url: 'https://sala.example.org/private?access_token=synthetic-secret', fields: ['time'], excerpt: 'Do not expose credentials.' }],
    }]])
    if (verdict === 'wrong') {
      // Use an existing manual preview and a spent rebuild budget so the error is reported on this revision.
      const review = w.reviewer
      w.reviewer = async () => { throw new Error('Review unavailable') }
      await w.job().tick()
      w.reviewer = review
      const draft = w.draft()
      draft.reviewRebuilds = { day: '2026-11-18', count: 2 }
      writeFileSync(job.draftFile(draft.id), JSON.stringify(draft))
    }
    await job.tick()
    const reply = w.reviewPosts.find(post => post.text.includes(verdict === 'question' ? 'hace falta tu decisión' : 'se detectó un error'))
    expect(reply?.text).toContain(verdict === 'question' ? question.question : wrong.reason!)
    expect(reply?.text).toContain(`<https://baeventos.com/events/${badId}|`)
    expect(reply?.text).toContain(`<${postUrl}>`)
    expect(reply?.text).toContain(`<${url.replace('&', '&amp;')}>`)
    expect(reply?.text).toContain('“`Función de *teatro físico* &lt;@U123&gt; &amp; muestra.`”')
    expect(reply?.text).not.toContain('synthetic-secret')
    expect(reply?.text).toContain('Show 21:00 · teatro físico')
    expect(reply?.text).not.toContain('<@U123>')
    expect(w.broadcasts()).toHaveLength(verdict === 'question' ? 1 : 0)
  })

  it.each([
    { legacy: false, failure: 'first ack' }, { legacy: true, failure: 'first ack' },
    { legacy: false, failure: 'continuation ack' }, { legacy: false, failure: 'continuation not sent' }, { legacy: true, failure: 'refused' },
  ])('preserves oversized evidence across $failure (legacy preview: $legacy)', async ({ legacy, failure }) => {
    const w = world()
    if (legacy) w.config.slack.channel = 'C0CHBCSEV3R'
    w.verdict = id => id === badId ? question : OK
    const links = Array.from({ length: 40 }, (_, i) => `https://www.instagram.com/p/${String(i).padStart(2, '0')}${'a'.repeat(65)}/`)
    const job = w.job()
    job.s.reviewResources = async () => new Map([[badId, { address: null,
      observations: links.map(postUrl => ({ postUrl, caption: '', publishedAt: null, excerpts: [] })), officialPages: [],
    }]])
    const post = job.s.slackPost
    let parent: string | undefined
    let failed = false
    const receipts = new Map<string, string>()
    const seen: string[] = []
    job.s.slackReviewReceipt = async (_channel, _thread, receipt) => {
      seen.push(receipt.id)
      return receipts.get(receipt.id) ?? null
    }
    job.s.slackPost = async (...args) => {
      const continuation = args[0].includes('Revisión: continuación')
      const receipt = args[4]?.id
      const fail = !failed && (continuation ? failure !== 'first ack' : failure === 'first ack')
      if (continuation || fail) expect(w.draft().pendingReviewReplies).toHaveLength(1)
      if (fail) failed = true
      if (fail && failure === 'refused') throw new SlackRejected('rate limited')
      if (fail && failure === 'continuation not sent') throw new Error('lost before posting')
      const response = await post(...args) as { ts: string }
      if (receipt) receipts.set(receipt, response.ts)
      if (!args[1]) parent = response.ts
      if (fail) throw new Error('posted but lost acknowledgement')
      return response
    }
    await job.tick()
    const ts = legacy ? parent : w.draft().slack.ts
    expect(w.draft().pendingReviewReplies).toHaveLength(1)
    await job.tick()
    expect(seen).toHaveLength(failure.startsWith('continuation') || (legacy && failure === 'first ack') ? 1 : 0)
    const posts = w.slackCalls.filter(call => call.method === 'chat.postMessage' && call.text?.includes('Revisión:'))
    expect(posts).toHaveLength(2)
    expect(posts.every(call => call.text!.length <= 4000 && call.channel === 'C0CG3EGKKP1')).toBe(true)
    expect(posts[1]).toMatchObject({ ts })
    expect(posts[1]?.reply_broadcast).toBeUndefined()
    for (const link of links) expect(posts.filter(call => call.text!.includes(`<${link}>`))).toHaveLength(1)
    expect(w.draft().pendingReviewReplies).toEqual([])
  })

  it.each(['quick', 'fallback'] as const)('reports and rebuilds a directly contradicted %s question without asking', async stage => {
    const w = world()
    if (stage === 'fallback') w.investigator = { start: async () => { throw new Error('Should be capped') }, running: async () => false }
    const job = w.job()
    if (stage === 'fallback') await job.tick()
    w.verdict = id => id === badId ? { ...question, question: 'Can you confirm that admission is free?', field: 'price' } : OK
    if (stage === 'fallback') {
      const draft = await job.regenerate(w.draft().id, [])
      draft.investigationCount = 2
      draft.review!.result!.questionResolution = { quick: { model: 'fake-vision', resolved: [] } }
      writeFileSync(job.draftFile(draft.id), JSON.stringify(draft))
    }
    const url = 'https://sala.example.org/entradas'
    const quote = 'Las entradas cuestan $5000.'
    job.s.reviewResources = async () => new Map([[badId, { address: null, observations: [], officialPages: [{ url, fields: ['price'], excerpt: quote }] }]])
    job.s.resolveQuestions = (input, questions) => resolveReviewQuestionsWithOpenAI(DEFAULT_REVIEW, 'synthetic-key', 'test', input, questions,
      async (_url, request) => JSON.parse(String(request?.body)).text.format.name === 'publisher_citation_check' ? modelResponse({ direct: [badId], venue: [] })
        : resolverResponse([{ id: badId, verdict: 'wrong', field: 'price', reason: 'The ticket page states paid admission.', citations: [{ url, quote }] }]))
    await job.tick()
    expect(w.draft()).toMatchObject({ revision: stage === 'quick' ? 2 : 3, exclude: [badId] })
    expect(w.draft().reviewHistory?.at(-1)?.questionResolution?.[stage]?.resolved).toMatchObject([{ id: badId, verdict: 'wrong', citations: [{ url, quote }] }])
    const alert = w.alerts.find(alert => alert.key === `review-fix/${badId}`)
    for (const resource of [`https://baeventos.com/events/${badId}`, url, quote]) expect(alert?.text).toContain(resource)
    expect(w.broadcasts()).toEqual([])
  })

  it.each(['selected', 'one omission', 'unavailable'] as const)('shows each source with its own quote when the resolver is %s', async mode => {
    const w = world()
    w.verdict = id => id === badId ? { ...question, field: 'price', question: 'Is there a charge at the door?' } : OK
    const job = w.job()
    const pairs = [['https://www.instagram.com/p/venue/', 'No se cobra entrada a menores.'], ['https://www.instagram.com/p/organizer/', 'FUNCIONES GRATUITAS'],
      ['https://venue.example.org/events', 'Acceso gratuito hasta agotar capacidad.'], ['https://tickets.example.org/show', 'Entrada general $9000.']] as const
    const opening = 'Hoy a las 20:00.'
    job.s.reviewResources = async () => new Map([[badId, { address: null, observations: [
      { postUrl: pairs[0][0], caption: `${opening}\n${pairs[0][1]}`, publishedAt: null, excerpts: [] },
      { postUrl: pairs[1][0], caption: 'Montaje anual de teatro.', publishedAt: null, excerpts: [{ fields: ['description'], excerpt: pairs[1][1] }] },
    ], officialPages: pairs.slice(2).map(([url, excerpt]) => ({ url, fields: ['price'], excerpt })) }]])
    job.s.resolveQuestions = (input, questions) => resolveReviewQuestionsWithOpenAI(DEFAULT_REVIEW, 'synthetic', 'test', input, questions, async () => {
      if (mode === 'unavailable') throw new Error('The resolver timed out')
      return resolverResponse([], [selection(badId, (mode === 'one omission' ? pairs.slice(2) : pairs).map(([url, quote]) => ({ url, quote })))])
    })
    await job.tick()
    const text = w.broadcasts()[0]?.text
    const [venue, organizer, ...pages] = pairs
    expect(text).toContain(`<${venue[0]}>\n“${mode === 'selected' ? venue[1] : `${opening} ${venue[1]}`}”`)
    expect(text).toContain(`<${organizer[0]}>\n“${mode === 'selected' ? organizer[1] : 'Montaje anual de teatro.'}”`)
    for (const [url, quote] of pages) expect(text).toContain(`<${url}>\n“${quote}”`)
  })

  it('asks Hanif about a post question, even with a separate confirmed event error', async () => {
    const w = world()
    const review = w.reviewer
    w.reviewer = async input => ({ ...(await review(input)), post: question })
    w.verdict = id => id === badId ? wrong : OK
    await w.job().tick()
    expect(w.slackCalls.some(call => call.method === 'files.completeUploadExternal')).toBe(true)
    expect(w.broadcasts()).toEqual([expect.objectContaining({ text: expect.stringContaining(question.question) })])
  })

  it.each([
    { previewChannel: 'C_TEST_APPROVALS', loseResponse: false, failLookup: false },
    { previewChannel: 'C0CHBCSEV3R', loseResponse: false, failLookup: true },
    { previewChannel: 'C_TEST_APPROVALS', loseResponse: true, failLookup: false },
  ])('posts one question in #alerts with the $previewChannel override still set (lost response: $loseResponse, permalink fails: $failLookup)', async ({ previewChannel, loseResponse, failLookup }) => {
    const w = world()
    const alertsChannel = w.config.slack.channel
    w.config.slack.channel = previewChannel
    const reviewer = w.reviewer
    w.reviewer = async () => { throw new Error('Review unavailable') }
    await w.job().tick()
    const draft = w.draft()
    expect(draft.slack).toMatchObject({ channel: previewChannel, ts: expect.any(String) })
    if (previewChannel === 'C0CHBCSEV3R') {
      delete draft.slack.channel
      delete draft.slack.previews
      writeFileSync(w.job().draftFile(draft.id), JSON.stringify(draft))
    }
    w.reviewer = async input => ({ ...(await reviewer(input)), post: question })
    w.slackCalls = []
    const job = w.job()
    const lookup = job.s.slackPermalink
    job.s.slackPermalink = async (...args) => {
      const url = await lookup(...args)
      if (failLookup) throw new Error('Slack could not find the permalink')
      return url
    }
    const post = job.s.slackPost
    job.s.slackPost = async (...args) => {
      const response = await post(...args)
      if (loseResponse && args[1] === null) throw new Error('Lost Slack response after posting')
      return response
    }
    slot(w)
    await job.tick()
    await w.job().tick()
    expect(w.config.slack.channel).toBe(previewChannel)
    expect(w.slackCalls.filter(call => call.method === 'chat.getPermalink')).toEqual([
      { method: 'chat.getPermalink', ts: draft.slack.ts, channel: previewChannel },
    ])
    const domain = failLookup ? 'app.slack.com' : 'test-workspace.slack.com'
    expect(w.slackCalls.filter(call => call.method === 'chat.postMessage')).toEqual([{
      method: 'chat.postMessage', channel: alertsChannel,
      text: `<https://${domain}/archives/${previewChannel}/p10|Abrí la vista previa en Slack>\n\n> Revisión: hace falta tu decisión.\n> Respondé con ✅ o ❌ en la vista previa.\n> ${question.question}`,
    }])
    expect(w.ig.published).toHaveLength(0)
    expect(w.threads.posts).toHaveLength(0)
    w.approve()
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'published' } })
    const approvalReads = w.slackCalls.filter(call => call.method === 'reactions.get')
    expect(approvalReads.length).toBeGreaterThan(0)
    expect(approvalReads.every(call => call.channel === previewChannel && call.ts === draft.slack.ts)).toBe(true)
  })

  it('reserves the broadcast before sending and never repeats it after a lost response or rebuild', async () => {
    const w = world()
    w.verdict = id => id === badId ? question : OK
    w.loseBroadcastResponse = true
    const job = w.job()
    const post = job.s.slackPost
    const savedAtSend: Draft[] = []
    job.s.slackPost = async (text, ts, channel, broadcast) => {
      if (broadcast) savedAtSend.push(w.draft())
      return post(text, ts, channel, broadcast)
    }
    await job.tick()
    expect(savedAtSend).toEqual([expect.objectContaining({ decisionBroadcastAttempted: true })])
    slot(w)
    await w.job().tick()
    expect(w.slackCalls.filter(call => call.method === 'chat.postMessage')).toEqual(w.broadcasts())
    expect(w.broadcasts()).toHaveLength(1)
    expect(w.draft().decisionBroadcastAttempted).toBe(true)
    await w.job().regenerate(w.draft().id, [])
    await w.job().tick()
    expect(w.draft().revision).toBe(2)
    expect(w.reviewPosts.at(-1)?.threadTs).toBe(w.draft().slack.ts)
    expect(w.broadcasts()).toHaveLength(1)
  })

  it('releases a refused broadcast and retries once on the next tick', async () => {
    const w = world()
    w.verdict = id => id === badId ? question : OK
    w.slackFails = 1
    w.slackFailPrefix = 'Revisión:'
    await w.job().tick()
    expect(w.broadcasts()).toHaveLength(1)
    expect(w.draft().decisionBroadcastAttempted).toBeUndefined()
    expect(w.draft().review?.replied).toBeUndefined()
    expect(w.reviewPosts).toEqual([])
    await w.job().tick()
    await w.job().tick()
    expect(w.broadcasts()).toHaveLength(2)
    expect(w.reviewPosts).toHaveLength(1)
    expect(w.draft().decisionBroadcastAttempted).toBe(true)
  })

  it('waits for the current preview before broadcasting a question', async () => {
    const w = await previewed()
    const oldTs = w.draft().slack.ts
    w.verdict = id => id === badId ? question : OK
    const job = w.job()
    const share = job.s.slackShareFiles
    job.s.slackShareFiles = async () => { throw new SlackRejected('Slack refused the replacement preview') }
    await expect(job.regenerate(w.draft().id, [])).rejects.toThrow('Slack refused the replacement preview')
    await job.tick()
    expect(w.draft().slack.ts).toBe(oldTs)
    expect(w.broadcasts()).toEqual([])
    job.s.slackShareFiles = share
    await job.tick()
    const { ts } = w.draft().slack
    expect(ts).not.toBe(oldTs)
    expect(w.broadcasts()).toEqual([expect.objectContaining({ ts })])
  })

  it('reads approval and posts replies in #ba-eventos for an older draft with no stored channel', async () => {
    const w = await previewed()
    const draft = w.draft()
    delete draft.slack.channel
    delete draft.slack.previews
    writeFileSync(w.job().draftFile(draft.id), JSON.stringify(draft))
    w.slackCalls = []
    w.approve()
    slot(w)
    await w.job().tick()
    expect(w.draft().state).toBe('published')
    expect(w.slackCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'reactions.get', ts: draft.slack.ts, channel: 'C0CHBCSEV3R' }),
      expect.objectContaining({ method: 'chat.postMessage', ts: draft.slack.ts, channel: 'C0CHBCSEV3R' }),
    ]))
  })

  it('excludes the dance/theatre flyer misread as dog training and reviews the replacement', async () => {
    const w = world()
    const reviewer = w.reviewer
    w.reviewer = async input => {
      const event = input.events.find(event => event.id === badId)
      if (event) {
        expect(event.description).toContain('Entrenamiento canino')
        expect(input.threads).toContain('18 mundos')
        w.verdict = id => id === badId ? wrong : OK
      }
      return reviewer(input)
    }
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 2, exclude: [badId] })
    expect(w.alerts).toEqual([expect.objectContaining({ key: `review-fix/${badId}`, text: expect.stringContaining('summary') })])
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'published' } })
    expect(w.draft().threads?.text).not.toContain('18 mundos')
    expect(w.reviewCalls).toBe(2)
    expect(w.draft().reviewHistory).toEqual([expect.objectContaining({ revision: 1,
      events: expect.arrayContaining([{ id: badId, ...wrong }]) })])
  })

  it('skips both channels and replies to the previous preview if removing the event leaves too few', async () => {
    const w = world()
    w.catalog = w.catalog.slice(0, 4)
    w.config.auto.finde = false // Only a draft that already needed a preview has a thread for the skip.
    w.verdict = id => id === badId ? wrong : OK
    await w.job().tick()
    expect(w.draft().state).toBe('skipped')
    expect(w.slackPosts).toContainEqual({ text: expect.stringContaining('only 3 events qualified'), threadTs: '1.0' })
    slot(w)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    expect(w.threads.posts).toHaveLength(0)
  })

  it.each(['question', 'missing', 'wrong'] as const)('does not auto-publish with %s, but accepts ✅ on the same revision', async outcome => {
    const w = world()
    if (outcome === 'missing') w.reviewer = async () => { w.reviewCalls++; throw new Error('Review unavailable') }
    else w.verdict = id => id === badId ? outcome === 'question' ? question : wrong : OK
    if (outcome === 'wrong') {
      // Both destinations are approval-only. This doesn't test approval of an automatic destination blocked by a known error.
      w.config.auto.finde = w.config.threads.auto.finde = false
      w.approve()
    }
    await w.job().tick()
    w.reactions = []
    if (outcome === 'wrong') {
      // An unrepairable wrong revision still needs a ✅, including after its rebuild budget is used.
      const saved = w.draft()
      saved.reviewRebuilds = { day: '2026-11-19', count: 2 }
      writeFileSync(w.job().draftFile(saved.id), JSON.stringify(saved))
    }
    w.at('2026-11-19', 11, 30)
    await w.job().tick()
    slot(w)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    expect(w.threads.posts).toHaveLength(0)
    if (outcome === 'question') {
      expect(w.reviewPosts[0]?.text).toContain(question.question)
      expect(w.broadcasts()).toEqual([expect.objectContaining({ text: expect.stringContaining('Respondé con ✅ o ❌ en la vista previa.') })])
    }
    if (outcome === 'missing') {
      expect(w.alerts.filter(alert => alert.key.endsWith('/review'))).toHaveLength(1)
      expect(w.reviewCalls).toBe(3)
    }
    w.approve()
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'published' } })
  })

  it('tries no third rebuild even across ticks and keeps previous exclusions', async () => {
    const w = world()
    const reviewer = w.reviewer
    w.reviewer = input => {
      w.verdict = id => id === input.events[0]?.id ? wrong : OK
      return reviewer(input)
    }
    slot(w)
    await w.job().tick()
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 3, reviewRebuilds: { count: 2 }, state: 'previewed' })
    expect(w.draft().exclude).toHaveLength(2)
    expect(w.reviewCalls).toBe(3)
    expect(w.ig.published).toHaveLength(0)
    expect(w.threads.posts).toHaveLength(0)
    expect(w.slackCalls).toEqual([])
  })

  it('keeps Hermes fixes pending if alerts fail, without delaying the replacement', async () => {
    const w = world()
    w.verdict = id => id === badId ? wrong : OK
    const job = w.job()
    const alert = job.s.alert
    job.s.alert = async (...args) => args[0].startsWith('review-fix/') ? false : alert(...args)
    await job.tick()
    expect(w.draft()).toMatchObject({ revision: 2, pendingReviewFixes: [{ key: `review-fix/${badId}` }] })
    slot(w)
    await w.job().tick()
    expect(w.draft().state).toBe('published')
    expect(w.draft().pendingReviewFixes).toBeUndefined()
    expect(w.alerts.some(item => item.key === `review-fix/${badId}`)).toBe(true)
  })

  it.each(['revision', 'framesHash', 'threads', 'disk'] as const)('rejects an earlier result if %s differs', async field => {
    const w = world()
    await w.job().tick()
    const saved = w.draft()
    if (field === 'threads') saved.threads!.text += '\nDifferent text'
    else if (field === 'revision') saved.review!.result!.revision++
    else if (field === 'framesHash') saved.review!.result!.framesHash = 'another hash'
    else writeFileSync(saved.frames[0]!, 'changed after review')
    writeFileSync(w.job().draftFile(saved.id), JSON.stringify(saved))
    slot(w)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    expect(w.threads.posts).toHaveLength(0)
    expect(w.reviewCalls).toBe(1)
  })

  it.each(['legacy', 'rejected'])('preserves the rules for a %s preview', async scenario => {
    const w = world()
    w.config.auto.finde = false // Force a preview, then model an auto preview already sent before this change.
    await w.job().tick()
    const saved = w.draft()
    delete saved.slack.channel
    delete saved.slack.previews
    delete saved.threads!.threadChannel
    saved.slack.auto = w.config.auto.finde = true
    if (scenario === 'legacy') delete saved.review
    writeFileSync(w.job().draftFile(saved.id), JSON.stringify(saved))
    if (scenario === 'rejected') {
      w.approve()
      w.reactions.push({ name: 'x', users: [HANIF] })
    }
    slot(w)
    await w.job().tick()
    const state = scenario === 'legacy' ? 'published' : 'skipped'
    expect(w.draft()).toMatchObject({ state, threads: { state } })
    expect(w.reviewCalls).toBe(1)
  })

  it('explains that a successful retry can release both automatic posts without approval', async () => {
    const w = world()
    const review = w.reviewer
    w.reviewer = async () => { throw new Error('Review temporarily unavailable') }
    await w.job().tick()
    const preview = w.slackPosts[0]?.text
    expect(preview).toContain('can still publish automatically if the review passes')
    expect(preview).toContain('puede publicarse automáticamente si pasa la revisión')
    expect(preview).not.toContain('once you react')
    w.reviewer = review
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'published' } })
  })

  it('retries unavailable reviews and resolves the Hermes alert when the same revision passes', async () => {
    const w = world()
    const reviewer = w.reviewer
    w.reviewer = async () => { throw new Error('Review unavailable') }
    w.at('2026-11-19', 11, 30)
    await w.job().tick()
    expect(w.alerts.map(item => item.key)).toEqual(['draft/finde-2026-11-20/review'])
    w.reviewer = reviewer
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'published' } })
    expect(w.recovery).toContainEqual({ key: 'draft/finde-2026-11-20/review', text: '✅ Review completed for finde-2026-11-20 r1.' })
  })

  it('sends the saved Reel cover, video, and card sample times to the reviewer', async () => {
    const w = world()
    const job = w.job()
    const from = '2026-11-20'
    const reel = await job.createDraft('reel', from, [], 1)
    const reviewer = w.reviewer
    w.reviewer = input => {
      expect(input.format).toBe('reel')
      expect(input.frames.map(path => path.split('/').at(-1))).toEqual(['reel.mp4', 'cover.jpg'])
      expect(input.reelHoldMids).toHaveLength(input.events.length + 1) // event cards and closing card; cover is already saved
      expect(input.caption).toBe(reel.caption)
      expect(input.threads).toBeNull()
      return reviewer(input)
    }
    await job.review(reel.id)
    expect(w.reviewCalls).toBe(2)
  })

  it('prints a fresh verdict on request without changing draft state or notifying anyone', async () => {
    const w = world()
    const job = w.job()
    await job.tick()
    const path = job.draftFile(w.draft().id)
    const before = readFileSync(path, 'utf8')
    w.verdict = id => id === badId ? wrong : OK
    const result = await job.review(w.draft().id)
    expect(result.events).toContainEqual({ id: badId, ...wrong })
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(w.slackCalls).toEqual([])
    expect(w.alerts).toEqual([])
    expect(w.broadcasts()).toEqual([])
  })
})

describe('tick: publisher investigation', () => {
  const flaggedId = uuid(1)
  const question: Verdict = { verdict: 'question', field: null, reason: null, question: 'Is 21:00 the start or the doors time?' }
  const wrong: Verdict = { verdict: 'wrong', field: 'summary', reason: 'Entrenamiento Perro is a theatre group, not a dog-training class.', question: null }
  const ok: Finding = { verdict: 'ok', reason: 'The venue lists the start at 21:00.', url: 'https://venue.example/18-mundos' }
  const exclude: Finding = { verdict: 'exclude', reason: 'This occurrence is out of scope.' }
  const ask: Finding = { verdict: 'ask', question: 'Does the show start at 21:00?', checked: 'The venue and ticket pages do not agree.' }
  const world = (verdict = question) => {
    const w = new World()
    w.config.auto.finde = w.config.threads.auto.finde = w.config.threads.enabled = true
    Object.assign(w.catalog[0]!, { name: '18 mundos — Montaje anual', venue: 'Café Artigas', summary: 'Entrenamiento canino.' })
    w.verdict = id => id === flaggedId ? verdict : OK
    const runs: Array<{ request: InvestigationRequest; dir: string }> = []
    w.investigator = { start: async (request, dir) => { runs.push({ request, dir }) }, running: async () => true }
    const finish = (finding: Finding, id = flaggedId, at = w.clock.getTime()) => {
      const { dir } = runs.at(-1)!
      writeFileSync(join(dir, `${id}.result.json`), JSON.stringify({ at, finding }))
      writeFileSync(join(dir, 'completed.json'), JSON.stringify({ at }))
    }
    return { w, runs, finish }
  }
  const during = (w: World, minute = 15) => w.at('2026-11-18', 18, minute)
  const slot = (w: World) => w.at('2026-11-19', 12)

  it('releases a quick-review false positive with investigator evidence for the same revision and no preview', async () => {
    const { w, runs, finish } = world(wrong)
    await w.job().tick()
    expect(runs).toHaveLength(1)
    expect(w.slackCalls).toEqual([])
    during(w)
    finish(ok)
    await w.job().tick()
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'published' } })
    expect(w.slackCalls).toEqual([])
  })

  it.each(['publish', 'reject', 'slack-down'])('keeps a visible thread through a silent rebuild (%s)', async action => {
    const { w, finish } = world(wrong)
    const review = w.reviewer
    w.reviewer = async () => { throw new Error('Review temporarily unavailable') }
    await w.job().tick()
    const { ts, channel } = w.draft().slack
    expect(ts).toBeTruthy()
    w.reviewer = review
    during(w)
    await w.job().tick()
    finish(exclude)
    w.verdict = () => OK
    if (action === 'slack-down') w.slackFails = 100
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 2, slack: { ts, channel } })
    if (action !== 'slack-down') expect(w.replies()).toContainEqual(expect.stringMatching(/Rebuilt/))
    expect(w.slackCalls.filter(call => call.method === 'files.completeUploadExternal')).toHaveLength(1)
    if (action === 'reject') w.reject()
    slot(w)
    const job = w.job()
    if (action === 'slack-down') job.s.slackReactions = async () => { throw new Error('Slack down') }
    await job.tick()
    if (action === 'slack-down') {
      expect(w.draft()).toMatchObject({ state: 'previewed', threads: { state: 'waiting' } })
      expect(w.ig.published).toEqual([])
      expect(w.threads.posts).toEqual([])
      w.at('2026-11-19', 12, 10)
      await w.job().tick()
    }
    const expected = action === 'reject' ? 'skipped' : 'published'
    expect(w.draft()).toMatchObject({ state: expected, threads: { state: expected } })
    if (action === 'publish') {
      expect(w.slackCalls.filter(call => call.method === 'chat.postMessage' && /^(Posted:|Threads: publicado)/.test(call.text!)))
        .toEqual([expect.objectContaining({ ts, channel, text: expect.stringContaining('Posted:') }),
          expect.objectContaining({ ts, channel, text: expect.stringContaining('Threads: publicado') })])
    }
  })

  it('never delivers or saves an earlier revision after a second rebuild publishes', async () => {
    const { w, runs, finish } = world(wrong)
    const review = w.reviewer
    w.at('2026-11-19', 11, 20)
    w.reviewer = async () => { throw new Error('Review temporarily unavailable') }
    await w.job().tick()
    w.reviewer = review
    w.at('2026-11-19', 11, 30)
    await w.job().tick()
    w.at('2026-11-19', 11, 40)
    finish(exclude)
    w.verdict = id => id === uuid(2) ? wrong : OK
    w.slackFailPrefix = 'Rebuilt:'
    w.slackFails = 20
    await w.job().tick()
    expect(runs).toHaveLength(2)
    expect(w.draft()).toMatchObject({ revision: 2, notify: { rebuilt: true } })
    w.at('2026-11-19', 11, 55)
    finish(exclude, uuid(2))
    w.verdict = () => OK
    w.slackFails = 0
    slot(w)
    await w.job().tick()
    expect(w.replies().some(text => text.startsWith('Rebuilt: revision 2'))).toBe(false)
    expect(w.draft()).toMatchObject({ revision: 3, state: 'published' })
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
  })

  it('reads the inherited veto before offering a different preview', async () => {
    const { w, finish } = world(wrong)
    const review = w.reviewer
    w.reviewer = async () => { throw new Error('Review temporarily unavailable') }
    await w.job().tick()
    const oldTs = w.draft().slack.ts
    w.reviewer = review
    during(w)
    await w.job().tick()
    finish(exclude)
    w.verdict = () => OK
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 2, slack: { ts: oldTs } })
    w.config.threads.auto.finde = false
    w.reject()
    slot(w)
    const job = w.job()
    job.s.slackReactions = async ts => ts === oldTs ? w.reactions : []
    await job.tick()
    expect(w.slackPosts.filter(post => !post.threadTs)).toHaveLength(1)
    expect(w.draft()).toMatchObject({ state: 'skipped', threads: { state: 'skipped' } })
    expect(w.ig.published).toEqual([])
  })

  it('defers an investigator rebuild while the existing vote cannot be read', async () => {
    const { w, finish } = world(wrong)
    w.config.auto.finde = false
    await w.job().tick()
    const oldTs = w.draft().slack.ts
    during(w)
    finish(exclude)
    w.reject()
    const job = w.job()
    job.s.slackReactions = async ts => { if (ts === oldTs) throw new Error('Slack rate limited the vote read'); return [] }
    await job.tick()
    expect(w.draft()).toMatchObject({ revision: 1, slack: { ts: oldTs } })
    expect(w.slackPosts.filter(post => !post.threadTs)).toHaveLength(1)
    job.s.slackReactions = async ts => ts === oldTs ? w.reactions : []
    slot(w)
    await job.tick()
    expect(w.draft()).toMatchObject({ state: 'skipped', threads: { state: 'skipped' } })
    expect(w.threads.posts).toEqual([])
  })

  it('queues once and lets an all-ok investigation clear only that exact preview for both channels', async () => {
    const { w, runs, finish } = world()
    await w.job().tick()
    during(w)
    await w.job().tick()
    expect(runs).toHaveLength(1)
    const saved = w.draft()
    expect(runs[0]?.request).toMatchObject({ revision: 1, framesHash: saved.framesHash, events: [{ id: flaggedId, ...question }] })
    expect(runs[0]!.request.endsAt - runs[0]!.request.startsAt).toBe(30 * 60_000)
    expect(w.reviewPosts).toHaveLength(0)
    finish(ok)
    await w.job().tick()
    expect(w.slackCalls).toEqual([])
    slot(w)
    await w.job().tick()
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'published' } })
    expect(w.threads.posts).toHaveLength(1)
    expect(w.reviewCalls).toBe(1)
    expect(w.broadcasts()).toEqual([])
  })

  it('keeps the verified 18 mundos performance after a catalog fix, rebuilds, and reviews the new card', async () => {
    const { w, runs, finish } = world(wrong)
    await w.job().tick()
    during(w)
    const summary = 'Un montaje de teatro físico.'
    w.catalog[0]!.summary = summary
    const receipt = { operation: uuid(20), id: flaggedId, field: 'description_summary_es', from: 'Entrenamiento canino.', to: summary,
      allOccurrences: true, at: w.clock.toISOString(), evidence: 'Flyer: teatro físico.', changes: [{ id: flaggedId, from: 'Entrenamiento canino.', to: summary }] }
    writeFileSync(join(runs[0]!.dir, 'fixes.jsonl'), `${JSON.stringify({ state: 'applied', receipt })}\n`)
    w.verdict = () => OK
    finish({ verdict: 'fixed', fixes: [receipt.operation] })
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 2, catalogFixes: [receipt], exclude: [], reviewRebuilds: { count: 1 } })
    expect(w.draft().events.find(event => event.id === flaggedId)?.description).toBe(summary)
    expect(w.reviewCalls).toBe(2)
    expect(w.slackCalls).toEqual([])
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'published' } })
  })

  it.each(['before findings', 'while investigating', 'during the findings reply'] as const)('Threads-only approval %s still routes a confirmed Instagram fix to Hermes', async approval => {
    const { w, runs, finish } = world(wrong)
    w.config.threads.auto.finde = false
    w.at('2026-11-19', 11, 35)
    await w.job().tick()
    const original = w.draft()
    expect(original.slack.previews).toEqual([expect.objectContaining({ instagram: false, threads: true })])
    if (approval !== 'during the findings reply') w.approve()
    if (approval === 'while investigating') {
      w.at('2026-11-19', 11, 45)
      await w.job().tick()
      expect(w.draft().review?.investigation?.findings).toBeUndefined()
    }
    w.at('2026-11-19', 11, 50)
    const name = 'Montaje de teatro físico'
    const receipt = { operation: uuid(20), id: flaggedId, field: 'name', from: w.catalog[0]!.name, to: name,
      allOccurrences: true, at: w.clock.toISOString(), evidence: 'Flyer: Montaje de teatro físico.', changes: [{ id: flaggedId, from: w.catalog[0]!.name, to: name }] }
    w.catalog[0]!.name = name
    w.verdict = () => OK
    writeFileSync(join(runs[0]!.dir, 'fixes.jsonl'), `${JSON.stringify({ state: 'applied', receipt })}\n`)
    finish({ verdict: 'fixed', fixes: [receipt.operation] })
    const job = w.job()
    if (approval === 'during the findings reply') {
      const post = job.s.slackPost
      job.s.slackPost = async (...args) => {
        const reply = await post(...args)
        if (args[0].startsWith('Revisión: investigación')) w.approve()
        return reply
      }
    }
    await job.tick()
    expect(w.alerts).toContainEqual(expect.objectContaining({ key: `review-fix/${flaggedId}`, text: expect.stringContaining('Rebuild before publishing.') }))
    expect(w.draft()).toMatchObject({ revision: 1, threads: { text: original.threads!.text } })

    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'previewed', threads: { state: 'published', text: original.threads!.text } })
    expect(w.ig.published).toEqual([])

    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 2, state: 'published', catalogFixes: [receipt],
      threads: { revision: 1, state: 'published', text: original.threads!.text, threadTs: original.slack.ts } })
    expect(w.draft().events.find(event => event.id === flaggedId)?.title).toBe(name)
    expect(w.threads.posts).toHaveLength(1)
    expect(w.slackCalls.filter(call => call.method === 'files.completeUploadExternal')).toHaveLength(1)
  })

  it('Instagram-only approval does not silence a confirmed error on automatic Threads', async () => {
    const { w, finish } = world(wrong)
    w.config.auto.finde = false
    await w.job().tick()
    expect(w.draft().slack.previews).toEqual([expect.objectContaining({ instagram: true, threads: false })])
    w.approve()
    during(w)
    finish(exclude)
    await w.job().tick()
    expect(w.alerts).toContainEqual(expect.objectContaining({ key: `review-fix/${flaggedId}`, text: expect.stringContaining(exclude.reason) }))
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'waiting' } })
    expect(w.threads.posts).toEqual([])
  })

  it.each([false, true])('excludes a settled event and applies the minimum (below minimum: %s)', async tooFew => {
    const { w, finish } = world(wrong)
    if (tooFew) w.catalog = w.catalog.slice(0, 4)
    await w.job().tick()
    during(w)
    finish(exclude)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 2, exclude: [flaggedId], state: tooFew ? 'skipped' : 'previewed' })
    expect(w.draft().events.some(event => event.id === flaggedId)).toBe(false)
  })

  it('excludes a confirmed wrong venue, alerts Hermes, and publishes the re-reviewed preview without asking Hanif', async () => {
    const { w, finish } = world({ ...wrong, field: 'venue', reason: 'The organizer lists a different venue.' })
    await w.job().tick()
    during(w)
    const reason = 'The card gives the wrong venue.'
    const hermes = 'Correct the venue on the catalog row.'
    const correction = 'https://venue.example/18-mundos-correction'
    const checked = `The venue posted a correction to its announcement: ${correction}`
    finish({ verdict: 'exclude', reason, hermes, checked })
    const job = w.job()
    const alert = job.s.alert
    job.s.alert = async (...args) => args[0].startsWith('review-fix/') ? false : alert(...args)
    await job.tick()
    expect(w.draft()).toMatchObject({ revision: 2, exclude: [flaggedId], pendingReviewFixes: [{ event: { recorded: { revision: 1, finding: { reason, checked } } } }] })
    expect(w.reviewCalls).toBe(2)
    expect(w.slackCalls).toEqual([])
    await w.job().tick()
    const fix = w.alerts.find(alert => alert.key === `review-fix/${flaggedId}`)
    expect(fix?.text).toContain(hermes)
    expect(fix?.text).toContain(`Checked (r1): The venue posted a correction to its announcement: <${correction}>`)
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'published' } })
    expect(w.broadcasts()).toEqual([])
  })

  it('includes the exclusion conclusion and earlier recorded findings in the fix alert after rebuilding', async () => {
    const { w, finish } = world(wrong)
    const job = w.job()
    await job.tick()
    during(w)
    const priorUrl = 'https://venue.example/previous-announcement'
    finish({ verdict: 'exclude', reason: 'The first announcement gives a different venue.', hermes: `Check the organizer’s first correction: ${priorUrl}` })
    // Regenerate before consuming r1; leave its on-time finding in the recorded research.
    await job.regenerate(w.draft().id, [])
    await job.tick()

    during(w, 20)
    const currentUrl = 'https://venue.example/correction'
    finish({ verdict: 'exclude', reason: `The venue moved the performance: ${currentUrl}`, hermes: 'Correct the catalog venue.' })
    await job.tick()
    expect(w.draft()).toMatchObject({ revision: 3, exclude: [flaggedId] })
    expect(w.slackCalls).toEqual([])
    const fix = w.alerts.find(alert => alert.key === `review-fix/${flaggedId}`)
    expect(fix?.text).toContain('Correct the catalog venue.')
    expect(fix?.text).toContain(`Checked (r2): The venue moved the performance: <${currentUrl}>`)
    expect(fix?.text).toContain('Checked (r1): The first announcement gives a different venue.')
    expect(fix?.text).toContain(`Checked (r1): Check the organizer’s first correction: <${priorUrl}>`)
  })

  it.each(['fixed', 'exclude'] as const)('routes a %s finding to Hermes when the rebuild budget is exhausted', async verdict => {
    const { w, runs, finish } = world(wrong)
    await w.job().tick()
    const draft = w.draft()
    draft.reviewRebuilds = { day: '2026-11-18', count: 2 }
    writeFileSync(w.job().draftFile(draft.id), JSON.stringify(draft))
    during(w)
    if (verdict === 'fixed') {
      const receipt = { operation: uuid(20), id: flaggedId, field: 'description_summary_es', from: 'Entrenamiento canino.', to: 'Un montaje de teatro físico.',
        allOccurrences: true, at: w.clock.toISOString(), evidence: 'Flyer: teatro físico.', changes: [{ id: flaggedId, from: 'Entrenamiento canino.', to: 'Un montaje de teatro físico.' }] }
      writeFileSync(join(runs[0]!.dir, 'fixes.jsonl'), `${JSON.stringify({ state: 'applied', receipt })}\n`)
      finish({ verdict, fixes: [receipt.operation] })
    } else finish(exclude)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'previewed', review: { investigation: { findings: { [flaggedId]: { verdict } } } } })
    expect(w.alerts).toContainEqual(expect.objectContaining({ key: `review-fix/${flaggedId}`, text: expect.stringContaining('Hermes') }))
    expect(w.slackCalls).toEqual([])
  })

  it.each([false, true])('broadcasts one Slack question even with a separate Hermes fix (Hermes fix: %s)', async needsFix => {
    const { w, finish } = world()
    await w.job().tick()
    during(w)
    const hermes = 'The ticket link on the catalog row needs correcting.'
    finish(needsFix ? { ...ask, hermes } : ask)
    await w.job().tick()
    slot(w)
    await w.job().tick()
    expect(w.broadcasts()).toEqual([{
      method: 'chat.postMessage', channel: w.config.slack.channel, ts: w.draft().slack.ts, reply_broadcast: true,
      text: `Revisión: investigación\n18 mundos — Montaje anual: ${ask.question}\n<https://baeventos.com/events/${flaggedId}|Evento en BA Eventos>\nChecked (r1): ${ask.checked}\nRespondé con ✅ o ❌ en la vista previa.`,
    }])
    expect(w.reviewPosts).toHaveLength(1)
    expect(w.alerts.some(alert => alert.key === `review-fix/${flaggedId}` && alert.text.includes(hermes))).toBe(needsFix)
    expect(w.draft().state).toBe('previewed')
    expect(w.threads.posts).toHaveLength(0)
    w.approve()
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'published' } })
  })

  it.each([undefined, 'The initial announcement did not list the new venue.'])('includes the excluded event’s correction in a mixed decision reply (checked: %s)', async checked => {
    const { w, runs, finish } = world(wrong)
    const questionId = uuid(2)
    w.verdict = id => id === flaggedId ? wrong : id === questionId ? question : OK
    await w.job().tick()
    expect(runs[0]?.request.events.map(event => event.id)).toEqual(expect.arrayContaining([flaggedId, questionId]))
    during(w)
    const url = 'https://venue.example/current-correction'
    const reason = 'The venue moved the performance.'
    finish({ verdict: 'exclude', reason, hermes: `Correct the catalog venue per ${url}`, checked })
    finish(ask, questionId)
    await w.job().tick()

    expect(w.broadcasts()).toHaveLength(1)
    const decision = w.broadcasts()[0]?.text
    expect(decision).toContain(ask.question)
    expect(decision).toContain(`Exclude: ${reason}`)
    expect(decision).toContain(`<${url}>`)
    if (checked) expect(decision).toContain(checked)
  })

  it.each(['not sent', 'ack lost'] as const)('recovers the first ordinary investigation reply part when %s', async failure => {
    const { w, finish } = world()
    w.config.auto.finde = false
    await w.job().tick()
    const draft = w.draft()
    const job = w.job()
    draft.decisionBroadcastAttempted = true // An earlier revision already asked Hanif.
    writeFileSync(job.draftFile(draft.id), JSON.stringify(draft))
    during(w)
    finish(ask)
    const links = Array.from({ length: 40 }, (_, i) => `https://www.instagram.com/p/${i}${'s'.repeat(65)}/`)
    job.s.reviewResources = async () => new Map([[flaggedId, { address: null, officialPages: [],
      observations: links.map(postUrl => ({ postUrl, caption: 'Función de teatro físico.', publishedAt: null, excerpts: [] })),
    }]])
    const receipts = new Map<string, string>()
    job.s.slackReviewReceipt = async (_channel, _thread, receipt) => receipts.get(receipt.id) ?? null
    const post = job.s.slackPost
    let interrupted = false
    job.s.slackPost = async (...args) => {
      const receipt = args[4]
      const interrupt = !interrupted && args[0].startsWith('Revisión: investigación')
      if (interrupt) {
        interrupted = true
        expect(receipt).toBeDefined()
        expect(w.draft().pendingReviewReplies?.[0]).toMatchObject({ inFlight: receipt, parts: [args[0], expect.stringContaining('continuación')] })
        if (failure === 'not sent') throw new Error('Stopped before the first post reached Slack')
      }
      const response = await post(...args) as { ts: string }
      if (receipt) receipts.set(receipt.id, response.ts)
      if (interrupt) throw new Error('Posted but lost the first acknowledgement')
      return response
    }
    await job.tick()
    expect(w.draft().pendingReviewReplies).toHaveLength(1)
    await job.tick()
    expect(w.draft().pendingReviewReplies).toEqual([])
    const posts = w.reviewPosts.filter(post => post.text.includes('Revisión:'))
    expect(posts.map(post => post.text.split('\n')[0])).toEqual(['Revisión: investigación', 'Revisión: continuación'])
    for (const link of links) expect(posts.filter(post => post.text.includes(`<${link}>`))).toHaveLength(1)
    expect(w.broadcasts()).toEqual([])
  })

  it.each(['missing', 'unreadable'] as const)('delivers a new thread report even when the old notice is %s', async oldNotice => {
    const { w, finish } = world()
    w.config.auto.finde = false
    w.config.slack.channel = 'C_TEST_APPROVALS'
    const job = w.job()
    const links = Array.from({ length: 37 }, (_, i) => `https://www.instagram.com/p/${i}${'s'.repeat(65)}/`)
    job.s.reviewResources = async () => new Map([[flaggedId, { address: null, officialPages: [],
      observations: links.map(postUrl => ({ postUrl, caption: 'Función de teatro físico.', publishedAt: null, excerpts: [] })),
    }]])
    const post = job.s.slackPost
    let notices = 0
    job.s.slackPost = async (...args) => {
      if (!args[1] && args[0].includes('> Revisión: investigación')) {
        notices++
        throw new Error('Stopped before the notice reached Slack')
      }
      return post(...args)
    }
    job.s.slackReviewReceipt = async () => {
      if (oldNotice === 'unreadable') throw new Error('The Slack history read failed')
      return null
    }

    await job.tick()
    during(w)
    finish(ask)
    await job.tick()
    const draft = w.draft()
    expect(draft).toMatchObject({ decisionBroadcastAttempted: true, pendingReviewReplies: [{ threadTs: null, parent: expect.any(Object) }] })
    await job.regenerate(draft.id, [])
    const revised = w.draft()
    expect(revised.slack.ts).toBeTruthy()
    expect(revised.slack.ts).not.toBe(draft.slack.ts)
    await job.tick()
    during(w, 20)
    finish(ask)
    await job.tick()

    const posts = w.slackCalls.filter(call => call.ts === revised.slack.ts && call.text?.startsWith('Revisión:'))
    expect(posts.map(post => post.text?.split('\n')[0])).toEqual(['Revisión: investigación', 'Revisión: continuación'])
    for (const link of links) expect(posts.filter(post => post.text?.includes(`<${link}>`))).toHaveLength(1)
    expect(w.draft().pendingReviewReplies).toEqual(draft.pendingReviewReplies)
    expect(notices).toBe(1)
    expect(w.broadcasts()).toEqual([])
  })

  it('keeps a later part of the same thread behind an uncertain send', async () => {
    const { w } = world()
    w.config.auto.finde = false
    const job = w.job()
    await job.tick()
    const draft = w.draft()
    const destination = { channel: w.config.slack.channel, threadTs: draft.slack.ts }
    const older = 'Revisión: primera parte'
    const newer = 'Revisión: segunda parte'
    const sentTo = (ts: string | null) => w.slackCalls.filter(call => call.ts === ts && call.text?.startsWith('Revisión:')).map(call => call.text)
    draft.pendingReviewReplies = [
      { ...destination, parts: [older], inFlight: { id: uuid(30), since: w.clock.getTime() } },
      { ...destination, parts: [newer] },
      { ...destination, threadTs: '99.0', parts: ['Revisión: otro hilo'] },
    ]
    writeFileSync(job.draftFile(draft.id), JSON.stringify(draft))
    job.s.slackReviewReceipt = async () => { throw new Error('Could not confirm the first send') }
    await job.tick()
    expect(sentTo(destination.threadTs)).toEqual([])
    expect(sentTo('99.0')).toEqual(['Revisión: otro hilo'])

    job.s.slackReviewReceipt = async () => null
    await job.tick()
    expect(sentTo(destination.threadTs)).toEqual([older, newer])
    expect(w.draft().pendingReviewReplies).toEqual([])
  })

  it('uses the new investigator question for sources and USIG instead of the old summary flag', async () => {
    const { w, finish } = world(wrong)
    await w.job().tick()
    during(w)
    finish({ ...ask, question: 'Which barrio should we show for the venue?' })
    const job = w.job()
    const postUrl = 'https://www.instagram.com/p/venue-with-address/'
    job.s.reviewResources = async () => new Map([[flaggedId, { address: null, observations: [{ postUrl, caption: 'Av. San Martín 5885', publishedAt: null,
      excerpts: [{ fields: ['description'], excerpt: 'Una performance teatral.' }] }], officialPages: [] }]])
    job.s.fetchUsig = async url => {
      expect(String(url)).toContain('SAN%20MARTIN%20AV.&altura=5885')
      return Response.json({ barrio: 'Agronomia' })
    }
    const quote = 'Av. San Martín 5885'
    job.s.resolveQuestions = (input, questions) => resolveReviewQuestionsWithOpenAI(DEFAULT_REVIEW, 'synthetic', 'test', input, questions, async (_url, options) => {
      const body = JSON.parse(String(options?.body))
      if (body.text.format.name === 'publisher_citation_check') return modelResponse({ direct: [], venue: [flaggedId] })
      expect(JSON.parse(body.input[0].content[0].text).events[0]).toMatchObject({ question: 'Which barrio should we show for the venue?', displayOnly: true })
      return resolverResponse([], [selection(flaggedId, [{ url: postUrl, quote }], { url: postUrl, quote, street: 'Av. San Martín', number: '5885' })])
    })
    await job.tick()
    const text = w.broadcasts()[0]?.text
    for (const resource of ['Which barrio', postUrl, '“Av. San Martín 5885”', 'barrio oficial: Agronomia']) expect(text).toContain(resource)
    expect(text).not.toContain('Una performance teatral.')
  })

  it.each(['legacy notification', 'approval', 'rejection', 'cutoff'] as const)('does not broadcast finished findings after %s', async blocker => {
    const { w, finish } = world()
    w.config.auto.finde = false // Keep the preview visible while the investigator works.
    await w.job().tick()
    during(w)
    finish(ask)
    const draft = w.draft()
    if (blocker === 'legacy notification') {
      draft.review!.homeAttempted = true
      writeFileSync(w.job().draftFile(draft.id), JSON.stringify(draft))
    }
    if (blocker === 'approval') w.approve()
    if (blocker === 'rejection') w.reject()
    if (blocker === 'cutoff') w.at('2026-11-20', 18)
    await w.job().tick()
    expect(w.reviewPosts.some(post => post.text.includes(ask.question))).toBe(true)
    expect(w.broadcasts()).toEqual([])
    if (blocker === 'legacy notification') {
      await w.job().regenerate(draft.id, [])
      during(w, 20)
      await w.job().tick()
      finish(ask)
      await w.job().tick()
      expect(w.draft()).toMatchObject({ revision: 2, decisionBroadcastAttempted: true })
      expect(w.broadcasts()).toEqual([])
    }
  })

  it('waits through intermittent unit probe failures and accepts completion during a probe', async () => {
    const { w, finish } = world()
    await w.job().tick()
    during(w, 10)
    w.investigator!.running = async () => { throw new Error('Could not reach the systemd user bus') }
    await w.job().tick()
    expect(w.draft().review?.investigation?.findings).toBeUndefined()
    during(w, 20)
    w.investigator!.running = async () => true
    await w.job().tick()
    during(w, 30)
    w.investigator!.running = async () => false
    await w.job().tick()
    expect(w.draft().review?.investigation?.findings).toBeUndefined()
    expect(w.alerts).toHaveLength(0)
    w.investigator!.running = async () => { finish(ok); return false }
    await w.job().tick()
    expect(w.draft().review?.investigation?.findings?.[flaggedId]).toEqual(ok)
    expect(w.alerts).toHaveLength(0)
  })

  it('does not turn a confirmed event error into an approval request when the investigator fails', async () => {
    const { w } = world(wrong)
    w.investigator!.start = async () => { throw new Error('No user service') }
    await w.job().tick()
    slot(w)
    await w.job().tick()
    expect(w.alerts.map(alert => alert.key)).toEqual(['investigator', `review-fix/${flaggedId}`])
    expect(w.slackCalls).toEqual([])
    expect(w.ig.published).toEqual([])
    expect(w.threads.posts).toEqual([])
  })

  it.each(['start', 'crash', 'missing', 'invalid', 'late', 'unacknowledged'] as const)('fails closed on %s and alerts Hermes only', async failure => {
    const { w, runs, finish } = world()
    if (failure === 'start') w.investigator!.start = async () => { throw new Error('No user service') }
    await w.job().tick()
    if (failure === 'crash') {
      w.investigator!.running = async () => false
      during(w)
      await w.job().tick()
      expect(w.draft().review?.investigation?.findings).toBeUndefined()
      expect(w.alerts).toHaveLength(0)
      during(w, 25)
    }
    if (failure === 'missing' || failure === 'late') during(w, 40)
    if (failure === 'late') finish(ok)
    if (failure === 'invalid') finish(ok, uuid(20))
    if (failure === 'unacknowledged') {
      writeFileSync(join(runs[0]!.dir, 'fixes.jsonl'), '{"state":"submitted","receipt":{"operation":"unconfirmed"}}\n')
      finish(ok)
    }
    await w.job().tick()
    expect(w.draft().review?.investigation?.findings?.[flaggedId]?.verdict).toBe('ask')
    expect(w.alerts.map(alert => alert.key)).toContain('investigator')
    slot(w)
    await w.job().tick()
    expect(w.broadcasts()).toEqual([])
    expect(w.draft().state).toBe('previewed')
    expect(w.threads.posts).toHaveLength(0)
  })

  it('keeps both destinations on hold when a catalog correction has no acknowledgement, even with a fallback answer', async () => {
    const { w, runs, finish } = world()
    await w.job().tick()
    during(w)
    writeFileSync(join(runs[0]!.dir, 'fixes.jsonl'), '{"state":"submitted","receipt":{"operation":"unconfirmed"}}\n')
    finish(ok)
    const job = w.job()
    const modes: Array<boolean | undefined> = []
    job.s.resolveQuestions = async (_input, questions) => {
      modes.push(...questions.map(item => item.displayOnly))
      return { model: 'fake-vision', resolved: [{ id: flaggedId, field: 'time', question: 'Is this the show time?', verdict: 'ok', reason: 'The venue lists showtime.',
        citations: [{ url: 'https://venue.example/show', quote: 'Show 21:00' }] }] }
    }
    await job.tick()
    slot(w)
    await job.tick()
    expect(modes).toEqual([true])
    expect(w.draft().review?.investigation).toMatchObject({ catalogWriteHold: true, findings: { [flaggedId]: { verdict: 'ask' } } })
    expect(w.broadcasts()).toEqual([])
    expect(w.ig.published).toHaveLength(0)
    expect(w.threads.posts).toHaveLength(0)
  })

  it.each(['wrong', 'question'] as const)('after two investigations, routes a quick-review %s without a third launch or rebuild', async verdict => {
    const { w, runs, finish } = world()
    w.verdict = id => w.catalog.filter(event => !w.job().loadDraft('finde-2026-11-20')?.exclude.includes(event.id))[0]?.id === id ? wrong : OK
    await w.job().tick()
    during(w)
    finish(exclude)
    await w.job().tick()
    finish(exclude, uuid(2))
    if (verdict === 'question') {
      const previous = w.verdict
      w.verdict = id => previous(id).verdict === 'wrong' ? question : OK
    }
    await w.job().tick()
    expect(runs).toHaveLength(2)
    expect(w.draft()).toMatchObject({ revision: 3, exclude: [flaggedId, uuid(2)], reviewRebuilds: { count: 2 } })
    if (verdict === 'question') {
      expect(w.broadcasts()).toEqual([expect.objectContaining({ text: expect.stringContaining('Not investigated: Two revisions have already been investigated.') })])
    } else {
      expect(w.slackCalls).toEqual([])
      expect(w.alerts).toContainEqual(expect.objectContaining({ key: `review-fix/${uuid(3)}` }))
    }
  })

  it.each([
    { mode: 'resources', usigFails: false, silent: false },
    { mode: 'quick', usigFails: false, silent: false },
    { mode: 'fallback', usigFails: false, silent: false },
    { mode: 'fallback', usigFails: true, silent: true },
  ])('handles reel-2026-11-27 r3 evidence ($mode, USIG failure: $usigFails, silent price: $silent)', async ({ mode, usigFails, silent }) => {
    const w = new World()
    const id = 'reel-2026-11-27'
    const [nomades, cepa] = [uuid(1), uuid(2)]
    const nomadesPost = 'https://www.instagram.com/p/DgFAIHrpkXN/'
    const genericPost = 'https://www.instagram.com/p/DgFlHsKkS0p/'
    const pricePost = 'https://www.instagram.com/p/DgDPZYOvzgM/'
    const usig = 'https://ws.usig.buenosaires.gob.ar/datos_utiles?calle=SAN%20MARTIN%20AV.&altura=5885'
    const priceCaption = '•Entrada libre y gratuita.'
    const priceFlyer = 'Sábado 28 · Exposición de diseño · 11 a 20 h · Entrada gratuita sujeta a capacidad de sala.'
    const addressFlyer = 'Av. San Martín 5885 · Orange Devoto'
    w.config.auto.reel = true
    w.at('2026-11-26', 18, 5)
    w.catalog.forEach(event => { event.startsAt = new Date(Date.parse(event.startsAt) + 7 * 86_400_000).toISOString() })
    Object.assign(w.catalog[0]!, { name: 'Nómades Artificiales', venue: 'Orange Devoto', barrio: 'Agronomía' })
    Object.assign(w.catalog[1]!, { name: 'CEPA: El Abrazo del Diseño', isFree: true, price: 0 })
    w.investigator = { start: async () => { throw new Error('The cap should stop a third investigation') }, running: async () => false }
    const job = w.job()
    await job.tick()
    await job.regenerate(id, [])
    const review = w.reviewer
    w.reviewer = async input => {
      const result = await review(input)
      if (input.format !== 'reel') return result
      return { ...result, events: result.events.map(event => ({ ...event, ...(event.id === nomades ? {
        verdict: 'question', question: 'The flyer lists Av. San Martín 5885 in Devoto, but the card says Agronomía. Which barrio is correct?',
      } : event.id === cepa ? { verdict: 'question', question: 'Can you confirm CEPA is free? The venue post does not state a price.' } : {}) })) }
    }
    const { mkdirSync } = await import('node:fs')
    const priorDir = join(w.dir, 'drafts', id, 'investigation-2')
    const at = w.clock.getTime()
    mkdirSync(priorDir, { recursive: true })
    writeFileSync(join(priorDir, 'request.json'), JSON.stringify({ id, revision: 2, startsAt: at - 20_000, endsAt: at - 1, events: [{ id: nomades }] }))
    writeFileSync(join(priorDir, `${nomades}.result.json`), JSON.stringify({ at: at - 10_000, finding: {
      verdict: 'ok', reason: 'USIG places this street number in Agronomía.', url: usig,
    } }))
    writeFileSync(join(priorDir, 'completed.json'), JSON.stringify({ at: at - 9_000 }))
    job.s.reviewResources = async () => new Map([
      [nomades, { address: null, observations: [{ postUrl: nomadesPost, caption: addressFlyer, publishedAt: null,
        excerpts: [{ fields: ['date'], excerpt: 'Sábado 28' }] }], officialPages: [] }],
      [cepa, { address: null, observations: [{ postUrl: genericPost, caption: 'La muestra abre el sábado.', publishedAt: null, excerpts: [] },
        { postUrl: pricePost, caption: silent ? 'Vení a descubrir el diseño local.' : priceCaption, publishedAt: null, excerpts: [
          ...(silent ? [] : [{ fields: ['price'], excerpt: priceFlyer }]),
          { fields: ['name'], excerpt: 'El abrazo del diseño' },
        ] }], officialPages: [] }],
    ])
    const lookedUp: string[] = []
    job.s.fetchUsig = async (url, options) => {
      lookedUp.push(String(url))
      expect(options).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) })
      if (usigFails) throw new DOMException('Timeout', 'TimeoutError')
      return Response.json({ barrio: 'Agronomia' })
    }
    const resolver: Services['resolveQuestions'] = (input, questions) => resolveReviewQuestionsWithOpenAI(DEFAULT_REVIEW, 'synthetic-key', 'test', input, questions,
      async (_url, request) => {
        const body = JSON.parse(String(request?.body))
        const payload = JSON.parse(body.input[0].content[0].text)
        if (body.text.format.name === 'publisher_citation_check') {
          expect(payload.claims).toContainEqual(expect.objectContaining({ id: nomades, venue: expect.objectContaining({ url: nomadesPost, quote: addressFlyer }) }))
          if (!silent && mode !== 'resources') expect(payload.claims).toContainEqual(expect.objectContaining({ id: cepa, proposed: expect.objectContaining({ citations: [{ url: pricePost, quote: priceCaption }] }) }))
          return modelResponse({ direct: [cepa], venue: [nomades] })
        }
        expect(body.text.format.name).toBe('publisher_question_resolution')
        expect(payload.events).toContainEqual(expect.objectContaining({ id: cepa, posts: [expect.objectContaining({ url: genericPost }), expect.objectContaining({ url: pricePost })] }))
        // If a source lacks the cited fact, even a confident model output cannot clear that question.
        return resolverResponse([
          { id: cepa, verdict: 'ok', field: 'price', reason: 'The linked caption explicitly says entry is free.', citations: [{ url: pricePost, quote: priceCaption }] },
        ], [selection(nomades, [{ url: nomadesPost, quote: addressFlyer }], { url: nomadesPost, quote: addressFlyer, street: 'Av. San Martín', number: '5885' }),
          selection(cepa, [{ url: pricePost, quote: priceFlyer }])])
      })
    if (mode === 'quick') job.s.resolveQuestions = resolver
    const draft = await job.regenerate(id, [])
    draft.investigationCount = 2
    if (mode === 'fallback') {
      // The first check left these questions open. Run the independent check at the investigation cap.
      draft.review!.result!.questionResolution = { quick: { model: 'fake-vision', resolved: [] } }
      job.s.resolveQuestions = resolver
    } else if (mode === 'resources') {
      // Simulate an already reviewed, capped draft, with the model choosing quotes for the reply only.
      draft.review!.result!.questionResolution = { quick: { model: 'fake-vision', resolved: [] }, fallback: { model: 'fake-vision', resolved: [] } }
      job.s.resolveQuestions = resolver
    }
    writeFileSync(job.draftFile(id), JSON.stringify(draft))
    await job.tick()
    expect(w.reel(id)).toMatchObject({ revision: 3, state: 'previewed', investigationCount: 2 })
    expect(lookedUp).toEqual([usig])
    if (mode !== 'resources' && !silent && !usigFails) {
      expect(w.reel(id)?.slack.ts).toBeNull()
      expect(w.broadcasts()).toEqual([])
      const audit = w.reel(id)?.review?.result?.questionResolution?.[mode === 'quick' ? 'quick' : 'fallback']
      expect(audit?.resolved).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: nomades, verdict: 'ok', citations: [{ url: nomadesPost, quote: addressFlyer }, { url: usig, quote: 'Agronomia' }] }),
        expect.objectContaining({ id: cepa, verdict: 'ok', citations: [{ url: pricePost, quote: priceCaption }] }),
      ]))
      expect(audit?.resolved).toHaveLength(2)
      w.at('2026-11-27', 12, 1)
      await job.tick()
      expect(w.reel(id)?.state).toBe('published')
      return
    }
    const notices = w.broadcasts().filter(post => post.ts === w.reel(id)?.slack.ts)
    expect(notices).toHaveLength(1)
    const text = notices[0]!.text!
    for (const link of [`https://baeventos.com/events/${nomades}`, `https://baeventos.com/events/${cepa}`, nomadesPost, genericPost, pricePost, usig.replace('&', '&amp;')]) {
      expect(text).toContain(link)
    }
    expect(text).toContain(`“${addressFlyer}”`)
    if (silent) expect(text).not.toContain(priceCaption)
    else expect(text).toContain(`“${priceFlyer}”`)
    expect(text).not.toContain('“El abrazo del diseño”')
    expect(text).toContain('Checked (r2): USIG places this street number in Agronomía.')
    expect(text).toContain(usigFails ? 'falló la consulta oficial.' : 'barrio oficial: Agronomia.')
    expect(text.match(/Not investigated: Two revisions have already been investigated\./g)).toHaveLength(1)
    expect(text).not.toContain('Checked: Two revisions')
  })

  it.each([false, true])('honors a reaction while the investigation is running (rejected: %s)', async rejected => {
    const { w, runs } = world()
    w.config.auto.finde = false // Manual Instagram needs a preview while the investigation runs.
    w.at('2026-11-19', 11, 55)
    await w.job().tick()
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'previewed', threads: { state: 'waiting' } })
    expect(w.ig.published).toHaveLength(0)
    w.approve()
    if (rejected) w.reactions.push({ name: 'x', users: [HANIF] })
    await w.job().tick()
    expect(readFileSync(join(runs[0]!.dir, 'stopped'), 'utf8')).toContain('reaction')
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: rejected ? 'skipped' : 'published' })
    expect(w.threads.posts).toHaveLength(rejected ? 0 : 1)
    expect(w.broadcasts()).toEqual([])
  })

  it('reports finished findings but never replaces a preview Hanif already approved', async () => {
    const { w, finish } = world(wrong)
    w.config.auto.finde = false
    await w.job().tick()
    during(w)
    finish(exclude)
    w.approve()
    slot(w)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ revision: 1, state: 'published', exclude: [] })
    expect(w.reviewPosts).toEqual([{ threadTs: w.draft().slack.ts, text: expect.stringContaining(exclude.reason) }])
    expect(w.broadcasts()).toEqual([])
  })

  it('does not reuse an all-ok resolution after the outgoing copy changes', async () => {
    const { w, finish } = world()
    await w.job().tick()
    during(w)
    finish(ok)
    await w.job().tick()
    const draft = w.draft()
    draft.caption += '\nChanged after investigation'
    writeFileSync(w.job().draftFile(draft.id), JSON.stringify(draft))
    slot(w)
    await w.job().tick()
    expect(w.draft().state).toBe('previewed')
    expect(w.threads.posts).toHaveLength(0)
  })

  it('prints a dry-run plan without writing or starting a new investigation', async () => {
    const { w, runs } = world()
    const fake = w.investigator
    w.investigator = undefined
    await w.job().tick()
    w.investigator = fake
    const draft = w.draft()
    expect(await w.job().investigate(draft.id, true)).toMatchObject({ round: 1, request: { revision: 1, id: draft.id } })
    expect(w.draft()).toEqual(draft)
    expect(runs).toHaveLength(0)
  })
})

describe('tick: preview alerts', () => {
  it('reconciles a new preview in the same tick without recording a failure', async () => {
    const w = new World()
    const job = w.job()
    const channels: string[] = []
    job.s.slackShareTs = async (_file, channel) => {
      channels.push(channel)
      w.config.slack.channel = 'C_TEST_MOVED'
      return channels.length === 1 ? null : '42.0'
    }
    await job.tick()
    expect(channels).toEqual(['C0CG3EGKKP1', 'C0CG3EGKKP1'])
    expect(w.draft()).toMatchObject({ state: 'previewed', slack: { ts: '42.0', channel: 'C0CG3EGKKP1' } })
    expect(w.slackPosts).toHaveLength(1)
    expect(w.alerts).toEqual([])
    expect(w.logs).toContain('finde-2026-11-20: Slack preview lookup failed: the upload has no message yet')
    expect(() => readFileSync(join(w.dir, 'tick-failures.json'))).toThrow(/ENOENT/)
  })

  it('logs a too-few skip without Slack and drops a queued legacy top-level skip', async () => {
    const w = new World()
    w.catalog = []
    await w.job().tick()
    const saved = w.draft()
    expect(saved).toMatchObject({ state: 'skipped', notify: null, skipReason: 'Skipped: only 0 events qualified' })
    saved.notify = { threadTs: null, text: 'Skipped: only 0 events qualified', failures: 3 }
    const deliveryAlert = `draft/${saved.id}/slack`
    w.openAlerts.set(deliveryAlert, 'ratelimited')
    writeFileSync(w.job().draftFile(saved.id), JSON.stringify(saved))
    w.at('2026-11-18', 18, 10)
    await w.job().tick()
    expect(w.draft().notify).toBeNull()
    expect(w.slackCalls).toEqual([])
    expect(w.openAlerts.has(deliveryAlert)).toBe(false)
    expect(w.recovery).not.toContainEqual(expect.objectContaining({ key: deliveryAlert }))
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
    expect(w.recovery).toContainEqual({ key: 'tick', text: '✅ *Instagram publisher recovered* at 18:50: the Este finde carousel preview for Nov 20–22 is in Slack.' })
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

describe('delegated draft decisions', () => {
  const reason = 'Slack thread 1234.5678'
  const approved = 'Aprobado por Hermes a pedido de Hanif.'
  const skipped = 'Descartado por Hermes a pedido de Hanif.'

  it('records the preview scope and publishes at the slot without a Slack ✅', async () => {
    const w = await previewed()
    const draft = w.draft()
    await w.job().delegateDecision('approve', draft.id, 1, reason)
    expect(w.draft().approvedSeenAt).toBe(w.clock.toISOString())
    expect(w.draft().delegatedApprovals).toEqual([{
      actor: 'hermes', at: w.clock.toISOString(), reason,
      preview: { revision: 1, ts: draft.slack.ts, channel: w.config.slack.channel, instagram: true, threads: false },
    }])
    expect(w.slackCalls.at(-1)).toMatchObject({ method: 'chat.postMessage', channel: w.config.slack.channel, ts: draft.slack.ts, text: approved })
    await w.job().tick()
    expect(w.r2).toHaveLength(0)
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.draft().state).toBe('published')
  })

  it('refuses a stale revision and an approval at or after cutoff', async () => {
    const w = await previewed()
    const { id } = w.draft()
    await expect(w.job().delegateDecision('approve', id, 2, reason)).rejects.toThrow('current revision is r1')
    w.at('2026-11-20', 18)
    await expect(w.job().delegateDecision('approve', id, 1, reason)).rejects.toThrow('approval cutoff')
    expect(w.draft().delegatedApprovals).toBeUndefined()
    expect(w.replies()).not.toContain(approved)
  })

  it.each(['approve', 'reject'] as const)('refuses a new approval if Hanif already voted %s', async reaction => {
    const w = await previewed()
    const { id } = w.draft()
    w[reaction]()
    await expect(w.job().delegateDecision('approve', id, 1, reason)).rejects.toThrow(reaction === 'approve' ? 'needs approval' : 'already vetoed')
    expect(w.draft().delegatedApprovals).toBeUndefined()
    expect(w.replies()).toEqual([])
  })

  it('refuses to approve a silent auto draft', async () => {
    const w = new World()
    w.config.auto.finde = true
    await w.job().tick()
    const { id, slack } = w.draft()
    expect(slack.ts).toBeNull()
    await expect(w.job().delegateDecision('approve', id, 1, reason)).rejects.toThrow('no confirmed current preview')
  })

  it('keeps the original audit and makes only one reply attempt even if Slack fails', async () => {
    const w = await previewed()
    const { id } = w.draft()
    w.slackFailPrefix = approved
    w.slackFails = 1
    await expect(w.job().delegateDecision('approve', id, 1, reason)).resolves.toBe(true)
    const saved = w.draft()
    w.clock = new Date(w.clock.getTime() + 60_000)
    await expect(w.job().delegateDecision('approve', id, 1, 'different reason')).resolves.toBe(false)
    expect(w.draft()).toEqual(saved)
    expect(w.slackCalls.filter(call => call.text === approved)).toHaveLength(1)
    expect(w.logs).toContain(`${id}: could not send the delegated approve Slack reply`)
  })

  it.each(['Slack', 'delegated'])('refuses a new approval on an already approved preview after a %s veto', async veto => {
    const w = await previewed()
    const job = w.job()
    const { id, revision } = w.draft()
    await job.delegateDecision('approve', id, revision, reason)
    if (veto === 'Slack') w.reject()
    else await job.delegateDecision('skip', id, revision, 'Slack message 1234.5679')
    // The next tick has not settled the veto yet.
    const draft = w.draft()
    expect(draft.state).toBe('previewed')
    const replies = w.replies()
    await expect(job.delegateDecision('approve', id, revision, 'Slack message 1234.5680')).rejects.toThrow('Hanif already vetoed the draft')
    await expect(job.delegateDecision('approve', id, revision, reason)).resolves.toBe(false)
    expect(w.draft()).toEqual(draft)
    expect(w.replies()).toEqual(replies)
  })

  it('clears a delegated approval on rebuild and honors a veto on an earlier preview', async () => {
    const w = await previewed()
    const { id, slack } = w.draft()
    const services = w.services()
    let veto = false
    services.slackReactions = async ts => veto && ts === slack.ts ? [{ name: 'x', users: [HANIF] }] : []
    const job = new Job(services)
    await job.delegateDecision('approve', id, 1, reason)
    await job.regenerate(id, [uuid(2)])
    expect(w.draft().delegatedApprovals).toBeUndefined()
    w.at('2026-11-19', 18)
    await job.tick()
    expect(w.draft().state).toBe('previewed')
    expect(w.r2).toHaveLength(0)
    await job.delegateDecision('approve', id, 2, reason)
    veto = true
    await job.tick()
    expect(w.draft().state).toBe('skipped')
    expect(w.replies()).toContain('Skipped: you reacted ❌')
    expect(w.r2).toHaveLength(0)
  })

  it('an Instagram-only approval does not approve a later Threads preview, and a second approval does not replace the first', async () => {
    const w = new World()
    w.config.threads.enabled = true
    const review = w.reviewer
    w.reviewer = async input => {
      w.config.threads.enabled = false // Save Threads text, but don't show it on the first preview.
      return review(input)
    }
    await w.job().tick()
    const draft = w.draft()
    expect(draft.slack.previews?.[0]).toMatchObject({ instagram: true, threads: false })
    await w.job().delegateDecision('approve', draft.id, 1, reason)
    w.config.threads.enabled = true
    w.at('2026-11-19', 12)
    const job = new Job({ ...w.services(), loadToken: async () => ({ state: 'missing' }) })
    await job.tick()
    const threadsPreview = w.draft().slack.previews?.at(-1)
    expect(threadsPreview).toMatchObject({ instagram: false, threads: true })
    expect(w.threadsConnections).toBe(0)
    await expect(job.delegateDecision('approve', draft.id, 1, reason)).resolves.toBe(false)
    await expect(job.delegateDecision('approve', draft.id, 1, reason, threadsPreview!.ts)).rejects.toThrow('already approved a different preview')
    await expect(job.delegateDecision('approve', draft.id, 1, 'Slack message 1234.5690')).rejects.toThrow('multiple previews')
    await job.tick()
    expect(w.threadsConnections).toBe(0)
    await job.delegateDecision('approve', draft.id, 1, 'Slack message 1234.5690', threadsPreview!.ts)
    expect(w.draft().approvedSeenAt).toBe('2026-11-18T21:05:00.000Z')
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'published' } })
  })

  it('skips both destinations permanently even if Threads is temporarily disabled', async () => {
    const w = new World()
    w.config.threads.enabled = true
    await w.job().tick()
    const { id, slack } = w.draft()
    await w.job().delegateDecision('approve', id, 1, reason)
    w.config.threads.enabled = false
    await w.job().delegateDecision('skip', id, 1, reason)
    expect(JSON.parse(readFileSync(join(w.dir, 'vetoes', `${id}.json`), 'utf8'))).toEqual({
      actor: 'hermes', at: w.clock.toISOString(), reason, preview: { revision: 1, ts: slack.ts, channel: w.config.slack.channel, instagram: true, threads: true },
    })
    await expect(w.job().delegateDecision('skip', id, 1, reason)).resolves.toBe(false)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'skipped', threads: { state: 'skipped' } })
    await expect(w.job().delegateDecision('approve', id, 1, reason)).rejects.toThrow('skipped')
    await expect(w.job().regenerate(id, [])).rejects.toThrow('veto')
    w.config.threads.enabled = true
    w.at('2026-11-19', 18)
    await w.job().tick()
    expect(w.replies()).toEqual([approved, skipped])
    expect(w.r2).toHaveLength(0)
    expect(w.threadsConnections).toBe(0)
  })

  it('accepts a veto on the retained preview of a silent rebuild', async () => {
    const w = await previewed()
    const { id, slack } = w.draft()
    w.config.auto.finde = true
    const rebuilt = await w.job().regenerate(id, [uuid(2)])
    expect(rebuilt).toMatchObject({ revision: 2, slack: { ts: slack.ts, revision: 1 } })
    await w.job().delegateDecision('skip', id, 2, reason)
    expect(w.slackPosts).toContainEqual({ text: skipped, threadTs: slack.ts })
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.draft().state).toBe('skipped')
    expect(w.ig.published).toHaveLength(0)
  })

  it('preserves a published Instagram outcome and stops Threads with a saved unsent container', async () => {
    const w = await threadsPreviewed()
    const { id } = w.draft()
    await w.job().delegateDecision('approve', id, 1, reason)
    w.at('2026-11-19', 12)
    w.threads.containerStatus = 'IN_PROGRESS'
    await w.job().tick()
    const before = w.draft()
    expect(before).toMatchObject({ state: 'published', threads: { state: 'publishing', containerId: 'c1' } })
    await w.job().delegateDecision('skip', id, 1, reason)
    w.threads.containerStatus = 'FINISHED'
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', publish: { permalink: before.publish!.permalink }, threads: { state: 'skipped' } })
    expect(w.threads.posts).toHaveLength(0)
  })

  it('records a CLI veto while a tick holds the lock and stops the next Instagram write', async () => {
    const w = await previewed()
    const { id } = w.draft()
    await w.job().delegateDecision('approve', id, 1, reason)
    w.at('2026-11-19', 12)
    const get = w.ig.get.bind(w.ig)
    let output: string | undefined
    w.ig.get = async (path, params) => {
      if (params?.fields === 'status_code' && !output) {
        const slack = join(w.dir, 'slack.py')
        writeFileSync(slack, `print('{"ok":true}')\n`)
        const cli = fileURLToPath(new URL('../../../scripts/instagram-publisher.ts', import.meta.url))
        output = execFileSync(process.execPath, ['--experimental-transform-types', cli, 'skip', id, '--revision', '1', '--reason', reason], {
          encoding: 'utf8', timeout: 5_000, env: { BA_INSTAGRAM_STATE_DIR: w.dir, BA_INSTAGRAM_SLACK_API: slack, PATH: process.env.PATH },
        })
      }
      return get(path, params)
    }
    await withLock(() => w.job().tick(), w.dir)
    expect(output).toContain('Already-dispatched writes cannot be stopped')
    expect(w.draft().state).toBe('skipped')
    expect(w.ig.published).toHaveLength(0)
  })

  it.each(['unclear send', 'permalink read'])('reconciles a dispatched Instagram write after a veto during %s', async failure => {
    const w = await previewed()
    const { id } = w.draft()
    await w.job().delegateDecision('approve', id, 1, reason)
    w.at('2026-11-19', 12)
    const get = w.ig.get.bind(w.ig)
    if (failure === 'unclear send') w.ig.publishFault = 'after'
    else w.ig.get = async (path, params) => {
      if (params?.fields === 'permalink') throw new Error('fetch failed')
      return get(path, params)
    }
    await w.job().tick()
    w.ig.get = get
    expect(w.draft().state).toBe('publishing')
    expect(w.ig.published).toHaveLength(1)
    await expect(w.job().delegateDecision('approve', id, 1, reason)).rejects.toThrow('publishing')
    await w.job().delegateDecision('skip', id, 1, reason)
    const writes = w.ig.calls.filter(call => call.startsWith('POST'))
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.draft().state).toBe('published')
    expect(w.ig.calls.filter(call => call.startsWith('POST'))).toEqual(writes)
  })
})

describe.each(['Slack', 'Hermes'] as const)('publisher decision matrix: %s', channel => {
  const reason = 'Synthetic instruction 1'

  async function checkWorld(split = false) {
    const w = new World()
    w.config.threads.enabled = true
    const review = w.reviewer
    if (split) w.reviewer = async input => {
      w.config.threads.enabled = false // Build both texts but show only Instagram initially.
      return review(input)
    }
    const job = w.job()
    const votes = new Map<string, World['reactions']>()
    const unreadable = new Set<string>()
    job.s.slackReactions = async ts => {
      if (unreadable.has(ts)) throw new Error('Slack read failed')
      return votes.get(ts) ?? []
    }
    await job.tick()
    const saved = w.draft()
    const first = saved.slack.ts!
    const approve = async (ts?: string, instruction = reason) => {
      if (channel === 'Hermes') return job.delegateDecision('approve', saved.id, w.draft().revision, instruction, ts)
      votes.set(ts ?? first, [{ name: 'white_check_mark', users: [HANIF] }])
    }
    const veto = async () => {
      if (channel === 'Slack') votes.set(first, [{ name: 'x', users: [HANIF] }])
      else await job.delegateDecision('skip', saved.id, w.draft().revision, 'Synthetic veto')
    }
    const writes = () => ({ instagram: w.ig.calls.filter(call => call.startsWith('POST')),
      threads: w.threads.calls.filter(call => call === 'create' || call.startsWith('publish ')) })
    return { w, job, saved, first, approve, veto, writes, unreadable }
  }

  async function approvedSplitWorld() {
    const world = await checkWorld(true)
    const { w, job, saved, first, approve, writes } = world
    expect(saved.slack.previews).toEqual([expect.objectContaining({ revision: 1, ts: first, instagram: true, threads: false })])
    await approve()
    const receipt = w.draft().delegatedApprovals
    if (channel === 'Hermes') expect(receipt).toEqual([{
      actor: 'hermes', at: w.clock.toISOString(), reason, preview: saved.slack.previews?.[0],
    }])
    w.config.threads.enabled = true
    w.at('2026-11-19', 12)
    const load = job.s.loadToken
    job.s.loadToken = async () => ({ state: 'missing' }) // Show both previews while Hermes can still record approval.
    await job.tick()
    job.s.loadToken = load
    const split = w.draft()
    const second = split.slack.previews?.at(-1)
    expect(split).toMatchObject({ revision: 1, state: 'previewed', threads: { state: 'waiting' } })
    expect(second).toMatchObject({ revision: 1, instagram: false, threads: true })
    expect(second!.ts).not.toBe(first)
    expect(writes()).toEqual({ instagram: [], threads: [] })
    return { ...world, second: second!, receipt }
  }

  it.each([
    { name: 'replaying Instagram approval after a split still publishes only Instagram', run: async () => {
      const { w, job, approve, writes, receipt } = await approvedSplitWorld()
      const repliesBefore = w.slackPosts.length
      const replayed = await approve() // Replay the same instruction without a preview timestamp.
      if (channel === 'Hermes') {
        expect(replayed).toBe(false)
        expect(w.draft().delegatedApprovals).toEqual(receipt)
        expect(w.slackPosts).toHaveLength(repliesBefore)
      }
      w.at('2026-11-19', 12, 10)
      await job.tick()
      expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'waiting' } })
      expect(w.ig.published).toHaveLength(1)
      expect(writes().threads).toEqual([])
    } },
    { name: 'explicit approval of the Threads preview releases the second destination', run: async () => {
      const { w, job, saved, approve, writes, second } = await approvedSplitWorld()
      await approve(second.ts, 'Synthetic instruction 2')
      if (channel === 'Hermes') expect(w.draft().delegatedApprovals?.map(entry => entry.preview)).toEqual([saved.slack.previews?.[0], second])
      w.at('2026-11-19', 12, 10)
      await job.tick()
      expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'published' } })
      expect(w.ig.published).toHaveLength(1)
      expect(writes().threads).toEqual(['create', 'publish c1'])
    } },
    { name: 'an unreadable reaction pauses both destinations despite approval', run: async () => {
      const { w, job, first, approve, writes, unreadable } = await checkWorld()
      await approve()
      unreadable.add(first)
      w.at('2026-11-19', 12)
      await job.tick()
      expect(w.draft()).toMatchObject({ revision: 1, slack: { ts: first }, threads: { state: 'waiting', failures: 0 } })
      expect(writes()).toEqual({ instagram: [], threads: [] })
      unreadable.delete(first)
      w.at('2026-11-19', 12, 10)
      await job.tick()
      expect(w.draft()).toMatchObject({ revision: 1, state: 'published', threads: { state: 'published' } })
      expect(w.ig.published).toHaveLength(1)
      expect(writes().threads).toEqual(['create', 'publish c1'])
    } },
    { name: 'a veto targets both destinations from a retained preview after a silent rebuild', run: async () => {
      const { w, job, saved, first, approve, veto, writes } = await checkWorld()
      await approve()
      w.config.auto.finde = w.config.threads.auto.finde = true
      await job.regenerate(saved.id, [uuid(2)])
      const retained = { ts: first, channel: w.config.slack.channel, revision: 1, instagram: true, threads: true }
      expect(w.draft()).toMatchObject({ revision: 2, slack: { ts: first, revision: 1, previews: [retained] } })
      expect(w.draft().delegatedApprovals).toBeUndefined()
      const vetoAt = w.clock.toISOString()
      await veto()
      w.at('2026-11-19', 12)
      await job.tick()
      expect(w.draft()).toMatchObject({ revision: 2, state: 'skipped', threads: { state: 'skipped' } })
      if (channel === 'Hermes') expect(JSON.parse(readFileSync(join(w.dir, 'vetoes', `${saved.id}.json`), 'utf8'))).toEqual({
        actor: 'hermes', at: vetoAt, reason: 'Synthetic veto', preview: retained,
      })
      expect(writes()).toEqual({ instagram: [], threads: [] })
    } },
    { name: 'a veto during Threads polling stops its send without undoing Instagram', run: async () => {
      const { w, job, approve, veto, writes } = await checkWorld()
      await approve()
      const status = w.threads.status.bind(w.threads)
      let before: Draft | undefined
      w.threads.status = async id => {
        const result = await status(id)
        before = w.draft()
        await veto()
        return result
      }
      w.at('2026-11-19', 12)
      await withLock(() => job.tick(), w.dir)
      expect(before).toMatchObject({ revision: 1, state: 'published', threads: { state: 'publishing', containerId: 'c1', attemptedAt: null } })
      expect(w.draft()).toMatchObject({ revision: 1, state: 'published', publish: { permalink: before!.publish!.permalink }, threads: { state: 'skipped' } })
      expect(writes().threads).toEqual(['create'])
      expect(w.ig.published).toHaveLength(1)
      expect(w.threads.posts).toEqual([])
    } },
    { name: 'both providers can reconcile sent writes after a veto without publishing again', run: async () => {
      const { w, job, approve, veto, writes } = await checkWorld()
      await approve()
      w.ig.publishFault = w.threads.publishFault = 'after'
      w.at('2026-11-19', 12)
      await job.tick()
      expect(w.draft()).toMatchObject({ revision: 1, state: 'publishing', publish: { units: [{ mediaId: null }] }, threads: { state: 'publishing', mediaId: null } })
      expect(w.ig.published).toHaveLength(1)
      expect(w.threads.posts).toHaveLength(1)
      const { id: instagramId } = w.ig.published[0]!
      const [threadsPost] = w.threads.posts
      const sent = writes()
      await veto()
      w.at('2026-11-19', 12, 10)
      await job.tick()
      expect(w.draft()).toMatchObject({ revision: 1, state: 'published',
        publish: { units: [{ mediaId: instagramId }], permalink: `https://www.instagram.com/p/${instagramId}/` },
        threads: { state: 'published', mediaId: threadsPost!.id, permalink: threadsPost!.permalink } })
      expect(writes()).toEqual(sent)
    } },
  ])('$name', ({ run }) => run())
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
    const retry = w.alerts[1]
    expect(retry?.key).toBe('tick')
    expect(retry?.text).toContain('is on Instagram')
    expect(retry?.text).toContain('It tries again at 12:40 to find the link.')

    for (const [hour, minute] of [[12, 40], [12, 50], [13, 0], [13, 10], [13, 20]]) {
      w.at('2026-11-19', hour, minute)
      await w.job().tick()
    }
    expect(w.draft().state).toBe('failed')
    expect(w.ig.published).toHaveLength(1)
    const terminal = w.alerts.at(-1)
    expect(terminal?.key).toBe('draft/finde-2026-11-20')
    expect(terminal?.text).toContain('is on Instagram')
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
    await job.advance(draft.id, new TickFailures(job.s))
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

describe('Hoy link stickers', () => {
  const date = '2026-11-20'
  async function hoy(enabled = true) {
    const w = new World()
    w.config.linkStickers.hoy = enabled
    w.at(date, 11)
    const job = w.job()
    const render = job.s.render
    job.s.render = async (...args) => (await render(...args)).slice(0, 4)
    const draft = await job.createDraft('hoy', date, [], 1)
    w.at(date, 17)
    w.approve()
    const load = () => w.job().loadDraft(draft.id)!
    const advance = async () => {
      const fresh = w.job() // Re-read state like a new tick, not the in-memory draft.
      await fresh.advance(load().id, new TickFailures(fresh.s))
    }
    return { w, load, advance }
  }

  it('keeps Hoy on the Graph API when the flag is off', async () => {
    const { w, load, advance } = await hoy(false)
    await advance()
    expect(w.ig.published).toHaveLength(4)
    expect(load().state).toBe('published')
    expect(load().storyShare).toBeUndefined()
  })

  it('keeps the sticker-enabled publisher preview-only with no R2 configuration', async () => {
    const { w, load, advance } = await hoy()
    w.config.r2 = null
    let opened = false
    w.composeStory = async () => { opened = true; return [] }
    await advance()
    expect(opened).toBe(false)
    expect(load().state).toBe('previewed')
    expect(w.ig.calls).toEqual([])
  })

  it('falls back before Share, says why, and reports that the Story went out without links', async () => {
    const { w, load, advance } = await hoy()
    const evidence = join(w.dir, 'drafts', load().id, 'composer-failure-test')
    w.composeStory = async (_frames, action) => {
      expect('evidenceDir' in action && action.evidenceDir).toBe(join(w.dir, 'drafts', load().id))
      throw new StoryComposerError('open the Business Suite story composer', true, evidence)
    }
    // Leave one unclear Graph write and confirm it resumes via Graph next tick, never through the browser.
    w.ig.publishFault = 'after'
    await advance()
    expect(w.ig.published).toHaveLength(1)
    expect(w.alerts).toEqual([])
    w.composeStory = async () => { throw new Error('Must not return to the composer') }
    await advance()
    expect(w.ig.published).toHaveLength(4)
    expect(load().state).toBe('published')
    expect(load().storyShare).toBeUndefined()
    expect(w.alerts[0]?.text).toContain('went out on Instagram without tappable links')
    expect(w.alerts[0]?.text).toContain('Hermes needs to sign Facebook in again in the Pro agent browser.')
    expect(load().stickerFallback?.evidenceDir).toBe(evidence)
    expect(w.alerts[0]?.text).toContain(evidence)
  })

  it.each(['removed approval', 'rejection', 'deadline', 'cancelled event'])('re-checks %s after composing and does not fall back', async changed => {
    const { w, load, advance } = await hoy()
    w.composeStory = async (_frames, action) => {
      if (!('beforeShare' in action)) throw new Error('Expected Share callback')
      if (changed === 'removed approval') w.reactions = []
      if (changed === 'rejection') w.reject()
      if (changed === 'deadline') w.at(date, 19)
      if (changed === 'cancelled event') w.statuses.set(load().events[0]!.id, 'canceled')
      await action.beforeShare(new AbortController().signal, [])
      throw new Error('Must not allow Share')
    }
    await advance()
    const draft = load()
    expect(draft.storyShare).toBeUndefined()
    expect(draft.stickerFallback).toBeUndefined()
    expect(draft.state).toBe(changed === 'removed approval' ? 'previewed' : changed === 'cancelled event' ? 'held' : 'skipped')
    expect(w.ig.calls.some(call => call.startsWith('POST'))).toBe(false)
    expect(w.r2).toEqual([])
  })

  it('persists the attempt before Share, then only reads Graph after an unclear result even if the setting turns off and approval changes', async () => {
    const { w, load, advance } = await hoy()
    w.ig.postStoryByHand() // Existing Story in the same second; must not count it.
    let clicks = 0
    w.composeStory = async (_frames, action) => {
      if (!('beforeShare' in action)) throw new Error('Expected Share callback')
      await action.beforeShare(new AbortController().signal, ['sala1'])
      expect(load().storyShare).toEqual({ at: w.clock.toISOString(), frameCount: 4, beforeIds: ['m1'], skippedMentions: ['sala1'] })
      clicks++
      for (let i = 0; i < 3; i++) w.ig.postStoryByHand()
      throw new StoryComposerError('read the Share result')
    }
    await advance()
    expect(load().state).toBe('publishing')
    w.config.linkStickers.hoy = false
    w.config.r2 = null
    w.reject()
    w.ig.postStoryByHand() // The last browser frame now appears on Graph.
    w.at(date, 19)
    await advance()
    expect(load().state).toBe('published')
    const note = 'Skipped Instagram mentions (no exact username match): @sala1.'
    expect(load().note).toBe(note)
    expect(w.replies()).toContain(`Posted: https://www.instagram.com/baeventos.app/\n${note}`)
    expect(clicks).toBe(1)
    expect(w.r2).toEqual([])
    expect(new Set(w.ig.calls)).toEqual(new Set(['GET 17841/stories']))
  })

  it('holds an unconfirmed Share at the deadline, including when Graph is unavailable', async () => {
    const { w, load, advance } = await hoy()
    const evidence = join(w.dir, 'drafts', load().id, 'composer-failure-test')
    w.composeStory = async (_frames, action) => {
      if (!('beforeShare' in action)) throw new Error('Expected Share callback')
      await action.beforeShare(new AbortController().signal, [])
      w.ig.postStoryByHand()
      throw new StoryComposerError('read the Share result', false, evidence)
    }
    await advance()
    expect(load().storyShare?.evidenceDir).toBe(evidence)
    w.ig.get = async () => { throw new Error('Graph unavailable') }
    w.at(date, 19)
    await advance()
    expect(load().state).toBe('held')
    expect(w.alerts[0]?.text).toContain('Hermes needs to check @baeventos.app Stories.')
    expect(w.alerts[0]?.text).toContain(evidence)
    await expect(w.job().regenerate(load().id, [])).rejects.toThrow("can't be rebuilt")
    expect(w.r2).toEqual([])
    expect(w.ig.published).toEqual([])
  })

  it('falls back without recording a Share if the composer expires during the final checks', async () => {
    const { w, load, advance } = await hoy()
    w.composeStory = async (_frames, action) => {
      if (!('beforeShare' in action)) throw new Error('Expected Share callback')
      await action.beforeShare(AbortSignal.abort(), [])
      throw new Error('Must not allow Share')
    }
    await advance()
    expect(load().storyShare).toBeUndefined()
    expect(w.ig.published).toHaveLength(4)
  })

  it('saves the layout version on a new draft and places its stickers and tags by it', async () => {
    const { w, load, advance } = await hoy()
    expect(load().layout).toBe(LAYOUT_VERSION)
    let centers: number[] = []
    w.composeStory = async frames => { centers = frames.map(frame => frame.centerY); throw new StoryComposerError('place the link sticker') }
    await advance()
    expect(centers).toEqual([1440, 1577, 1577, 1390])
  })

  it('keeps the old sticker, mention, and tag positions for a Hoy draft rendered before layout versions', async () => {
    const { w, load, advance } = await hoy()
    const { layout: _layout, ...unversioned } = load()
    writeFileSync(w.job().draftFile(unversioned.id), JSON.stringify(unversioned))
    const hash = load().framesHash
    let seen: StickerFrame[] = []
    w.composeStory = async frames => { seen = frames; return [] }
    expect(await w.job().previewStickers(unversioned.id, '/test/previews')).toEqual([])
    expect(seen.map(frame => frame.centerY)).toEqual([1440, 1440, 1440, 1390])
    expect(seen[1]!.mentionAt).toEqual({ left: 66, centerY: 1618 })
    expect(seen.every(frame => frame.band === undefined)).toBe(true)
    // The live Business Suite route uses the same positions, on the frames that were approved: nothing is re-rendered.
    const renders = w.renderCount
    seen = []
    w.composeStory = async frames => { seen = frames; throw new StoryComposerError('open the Business Suite story composer') }
    await advance()
    expect(seen.map(frame => frame.centerY)).toEqual([1440, 1440, 1440, 1390])
    expect(w.renderCount).toBe(renders)
    expect(load().framesHash).toBe(hash)
    expect(load().layout).toBeUndefined()
    expect(load().state).toBe('published')
  })

  it('tags an unversioned carousel at its old footer position, and a new one at the new position', async () => {
    const tags = async (versioned: boolean) => {
      const w = await previewed()
      if (!versioned) {
        const { layout: _layout, ...old } = w.draft()
        writeFileSync(w.job().draftFile(old.id), JSON.stringify(old))
      }
      w.approve()
      w.at('2026-11-19', 12)
      await w.job().tick()
      expect(w.draft().state).toBe('published')
      const tagged = [...w.ig.containers.values()].flatMap(container => container.params.user_tags ? [JSON.parse(container.params.user_tags)[0]] : [])
      return tagged[0] as { username: string; x: number; y: number }
    }
    expect(await tags(false)).toEqual({ username: 'sala1', x: 0.116, y: 0.933 }) // 28 px text at left 80, 90 px above the bottom
    const now = await tags(true)
    expect(now.username).toBe('sala1')
    expect(now.y).toBe(0.96)
  })

  it('uses a preview-only action for the dry run and leaves state untouched', async () => {
    const { w, load } = await hoy(false)
    const draft = load()
    let previews = 0
    w.composeStory = async (frames, action) => {
      expect(action).toEqual({ previewDir: '/test/previews' })
      previews += frames.length
      return ['sala1']
    }
    expect(await w.job().previewStickers(draft.id, '/test/previews')).toEqual(['sala1'])
    expect(previews).toBe(4)
    expect(load()).toEqual(draft)
    expect(w.ig.calls).toEqual([])
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
  it('does not publish an approved draft after a selected event loses its in-scope judgment', async () => {
    const w = await previewed()
    w.approve()
    w.notInScope.add(uuid(3))
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.ig.calls.filter(call => call.startsWith('POST'))).toEqual([])
    expect(w.draft().state).toBe('held')
    expect(w.replies()).toEqual(['Held: Evento 3 is no longer marked in scope. Ask Hermes to regenerate it.'])
  })

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
  it('does not save a delivery result over a newer persisted revision', async () => {
    const w = await previewed()
    const draft = w.draft()
    draft.notify = { text: 'Rebuilt: revision 1', threadTs: draft.slack.ts, rebuilt: true }
    const job = w.job()
    writeFileSync(job.draftFile(draft.id), JSON.stringify(draft))
    job.s.slackPost = async () => {
      writeFileSync(job.draftFile(draft.id), JSON.stringify({ ...draft, revision: 2, notify: null }))
    }
    await job.tick()
    expect(w.draft()).toMatchObject({ revision: 2, notify: null })
  })

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

  it('keeps an unconfirmed Slack handoff until it can read the veto', async () => {
    const w = new World()
    w.config.auto.finde = true
    const review = w.reviewer
    w.reviewer = async () => { throw new Error('Review unavailable') }
    const job = w.job()
    job.s.slackShareTs = async () => null
    await job.tick()
    expect(w.slackPosts.filter(post => !post.threadTs)).toHaveLength(1)
    w.reviewer = review
    w.at('2026-11-19', 12)
    await job.tick()
    expect(w.ig.published).toEqual([])
    expect(w.draft().slack.pending).toBeDefined()
    w.reject()
    job.s.slackShareTs = async () => '1.0'
    w.at('2026-11-19', 12, 10)
    await job.tick()
    expect(w.draft()).toMatchObject({ state: 'skipped', slack: { ts: '1.0' } })
    expect(w.ig.published).toEqual([])
    expect(w.slackPosts.filter(post => !post.threadTs)).toHaveLength(1)
  })

  it('recovers a lost handoff before rebuilding and keeps its veto', async () => {
    const w = new World()
    w.config.auto.finde = true
    const review = w.reviewer
    w.reviewer = async () => { throw new Error('Review unavailable') }
    const job = w.job()
    job.s.slackShareTs = async () => { throw new Error('Slack response lost') }
    await job.tick()
    expect(w.draft().slack.ts).toBeNull()
    expect(w.slackPosts).toHaveLength(1)
    job.s.slackShareTs = async () => '1.0'
    w.reviewer = review
    const rebuilt = await job.regenerate(w.draft().id, [])
    expect(rebuilt).toMatchObject({ revision: 2, slack: { revision: 1, ts: '1.0', channel: 'C0CG3EGKKP1' } })
    expect(w.slackPosts.filter(post => !post.threadTs)).toHaveLength(1)
    w.reject()
    w.at('2026-11-19', 12)
    await job.tick()
    expect(w.ig.published).toEqual([])
    expect(w.draft().state).toBe('skipped')
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

describe('artwork', () => {
  it('renders each event\'s flyer, and the no-flyer card for an event without one', async () => {
    const w = new World()
    w.catalog[5]!.imageUrl = null
    await w.job().tick()
    expect(w.draft().events).toHaveLength(6)
    expect(w.html.match(/data-flyer/g)).toHaveLength(5)
    expect(w.html.match(/class="tile" data-fallback/g)).toHaveLength(1) // the page's script names the attribute too
    expect(w.html).not.toContain('hero-rooftop')
    expect(w.html).not.toMatch(/https?:\/\//) // nothing is fetched at render time
    const { existsSync } = await import('node:fs')
    expect(existsSync(w.artDirs[0]!)).toBe(false)
  })

  it('removes the downloaded flyers when the render fails', async () => {
    const w = new World()
    w.renderError = new Error('render crashed')
    await w.job().tick()
    const { existsSync } = await import('node:fs')
    expect(w.artDirs).toHaveLength(1)
    expect(existsSync(w.artDirs[0]!)).toBe(false)
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

  it('passes the downloaded flyers to the render and removes them afterwards', async () => {
    const w = await reelPreviewed()
    expect(w.reelRenders[0]!.flyers).toBe(6)
    const { existsSync } = await import('node:fs')
    expect(w.artDirs).toHaveLength(2)
    for (const dir of w.artDirs) expect(existsSync(dir)).toBe(false)
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
    expect(w.reel()?.skipReason).toBe('Skipped: only 3 events qualified')
    expect(w.slackCalls).toEqual([])
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

async function threadsPreviewed() {
  const w = new World()
  w.config.threads.enabled = true
  await w.job().tick()
  expect(w.draft().threads?.state).toBe('waiting')
  return w
}

describe('Threads in the publisher tick', () => {
  it('never accepts a ✅ on an Instagram-only preview for Threads', async () => {
    const w = new World()
    w.config.auto.finde = w.config.threads.enabled = w.config.threads.auto.finde = true
    await w.job().tick()
    w.config.auto.finde = w.config.threads.enabled = w.config.threads.auto.finde = false
    await w.job().tick()
    const instagramTs = w.draft().slack.ts
    expect(w.slackPosts[0]?.text).not.toContain('Threads (')
    expect(w.draft().threads?.threadTs).toBeUndefined()
    w.approve()
    const services = w.services()
    services.slackReactions = async ts => ts === instagramTs ? w.reactions : []
    const job = new Job(services)
    w.at('2026-11-19', 11, 50)
    await job.tick()
    const instagramApprovedAt = w.draft().approvedSeenAt
    expect(instagramApprovedAt).toBeTruthy()
    w.config.threads.enabled = true
    w.at('2026-11-19', 12)
    await job.tick()
    expect(w.draft().approvedSeenAt).toBe(instagramApprovedAt)
    expect(w.ig.published).toHaveLength(1)
    expect(w.threads.posts).toEqual([])
    expect(w.slackPosts.filter(post => !post.threadTs).at(-1)?.text).toContain('This preview only asks about Threads.')
    expect(w.slackPosts.filter(post => !post.threadTs).at(-1)?.text).toContain('un ✅ en este mensaje')
    expect(w.slackPosts.find(post => post.text.startsWith('Posted:'))?.threadTs).toBe(instagramTs)
    const threadsTs = w.draft().threads?.threadTs
    expect(threadsTs).toBeTruthy()
    expect(threadsTs).not.toBe(instagramTs)
    expect(w.slackPosts.find(post => post.text.includes('Threads ('))).toBeDefined()
    services.slackReactions = async ts => ts === threadsTs ? w.reactions : []
    await job.tick()
    expect(w.threads.posts).toHaveLength(1)
  })

  it.each(['reject', 'unreadable'])('checks every shown preview even after a replacement (%s)', async action => {
    const w = await threadsPreviewed()
    const originalTs = w.draft().slack.ts
    const job = w.job()
    const rebuilt = await job.regenerate(w.draft().id, [uuid(1)])
    expect(rebuilt.slack.ts).not.toBe(originalTs)
    w.approve()
    job.s.slackReactions = async ts => {
      if (ts !== originalTs) return w.reactions
      if (action === 'unreadable') throw new Error('Slack reactions.get failed: ratelimited')
      return [{ name: 'x', users: [HANIF] }]
    }
    w.at('2026-11-19', 12)
    await job.tick()
    expect(w.ig.published).toEqual([])
    expect(w.threads.posts).toEqual([])
    if (action === 'reject') expect(w.draft().state).toBe('skipped')
    else {
      job.s.slackReactions = async ts => ts === originalTs ? [] : w.reactions
      w.at('2026-11-19', 12, 10)
      await job.tick()
      expect(w.ig.published).toHaveLength(1)
      expect(w.threads.posts).toHaveLength(1)
    }
  })

  it.each(['Instagram', 'Threads'])('publishes automatic %s when the other destination cannot get a preview', async automatic => {
    const w = new World()
    const date = '2026-11-17'
    w.config.threads.enabled = true
    w.config.auto.hoy = automatic === 'Instagram'
    w.config.threads.auto.hoy = automatic === 'Threads'
    w.catalog = weekend().slice(0, 2).map(event => ({ ...event, startsAt: baInstant(date, 20).toISOString() }))
    const job = w.job()
    job.s.slackUploadFiles = async () => { throw new Error('Slack unavailable before upload') }
    w.at(date, 11, 30)
    await job.tick()
    w.at(date, 17)
    await job.tick()
    expect(w.ig.published).toHaveLength(automatic === 'Instagram' ? 8 : 0)
    expect(w.threads.posts).toHaveLength(automatic === 'Threads' ? 1 : 0)
    expect(w.slackCalls).toEqual([])
  })

  it('alerts an unthreaded Threads hold and resolves it after the replacement publishes', async () => {
    const w = new World()
    const date = '2026-11-17'
    w.config.threads.enabled = w.config.threads.auto.hoy = w.config.auto.hoy = true
    w.catalog = weekend().slice(0, 3).map(event => ({ ...event, startsAt: baInstant(date, 20).toISOString() }))
    w.at(date, 11)
    const job = w.job()
    await job.tick()
    w.statuses.set(uuid(1), 'cancelled')
    w.at(date, 11, 30)
    await job.tick()
    const draft = job.loadDraft(`hoy-${date}`)!
    expect(draft.threads).toMatchObject({ state: 'held', hold: { id: uuid(1), title: 'Evento 1', why: 'cancelled' } })
    expect(w.alerts).toContainEqual(expect.objectContaining({ key: `draft/hoy-${date}/threads`, text: expect.stringContaining('Evento 1 was cancelled') }))
    expect(w.alerts[0]?.text).toContain('regenerate')
    expect(w.threads.posts).toEqual([])
    expect(w.slackCalls).toEqual([])
    const key = `draft/${draft.id}/threads`
    w.at(date, 11, 40)
    await job.regenerate(draft.id, [uuid(1)])
    const resolve = job.s.resolveAlert
    job.s.resolveAlert = async (id, text) => id === key ? false : resolve(id, text)
    await job.tick()
    expect(w.threads.posts).toHaveLength(1)
    expect(w.openAlerts.has(key)).toBe(true)
    job.s.resolveAlert = resolve
    w.at(date, 11, 50)
    await job.tick()
    expect(w.threads.posts).toHaveLength(1)
    expect(w.openAlerts.has(key)).toBe(false)
  })
  it('appends the saved text to one preview and publishes both channels from that same later approval', async () => {
    const w = await threadsPreviewed()
    const { ts } = w.draft().slack
    expect(w.slackPosts).toHaveLength(1)
    expect(w.slackPosts[0]!.text).toContain(`Threads (se publica con el mismo ✅, 12:00):\n> ${w.draft().threads!.text!.split('\n').join('\n> ')}`)
    w.at('2026-11-19', 12)
    w.reactions = [{ name: 'white_check_mark', users: ['NOT_HANIF'] }]
    await w.job().tick()
    expect(w.threads.calls).toEqual([])
    expect(w.ig.published).toHaveLength(0)
    w.approve()
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
    expect(w.threads.posts[0]?.text).toBe(w.draft().threads?.text)
    expect(w.threads.calls).toEqual(['limit', 'create', 'status c1', 'limit', 'recent', 'publish c1', 'permalink m2'])
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'published', containerId: 'c1', mediaId: 'm2', permalink: w.threads.posts[0]!.permalink } })
    expect(w.slackPosts).toContainEqual({ text: `Threads: publicado ${w.threads.posts[0]!.permalink}`, threadTs: ts })
    expect(await threadsReport(w.job().allDrafts(), w.threads, baInstant('2026-11-20', 16), 28)).toContain(`2026-11-19\tfinde\t100\t2\t—\t—\t—\t3\t${w.threads.posts[0]!.permalink}\nFollowers: 31`)
    expect(await threadsReport(w.job().allDrafts(), w.threads, baInstant('2027-01-01', 12), 28)).not.toContain('finde')
  })

  it.each([false, true])('needs a ✅ when only the preview or only the current config allows auto (preview auto: %s)', async previewAuto => {
    const w = new World()
    w.config.threads.enabled = true
    w.config.auto.finde = w.config.threads.auto.finde = previewAuto
    await w.job().tick()
    expect(w.draft()).toMatchObject({ slack: { auto: previewAuto }, threads: { auto: previewAuto } })
    expect(w.slackCalls.some(call => call.method === 'files.completeUploadExternal')).toBe(!previewAuto)
    w.config.auto.finde = w.config.threads.auto.finde = !previewAuto
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.slackCalls.filter(call => call.method === 'files.completeUploadExternal')).toHaveLength(1)
    expect(w.ig.published).toHaveLength(0)
    expect(w.threads.calls).toEqual([])
    w.approve()
    await w.job().tick()
    expect(w.ig.published).toHaveLength(1)
    expect(w.threads.posts).toHaveLength(1)
  })

  it('skips both on ❌ on an existing auto preview, even with a ✅', async () => {
    const w = new World()
    w.config.threads.enabled = w.config.threads.auto.finde = true
    await w.job().tick()
    const saved = w.draft()
    expect(saved.slack.ts).not.toBeNull()
    saved.slack.auto = w.config.auto.finde = true
    writeFileSync(w.job().draftFile(saved.id), JSON.stringify(saved))
    w.at('2026-11-19', 12)
    w.reject()
    w.reactions.push({ name: 'white_check_mark', users: [HANIF] })
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'skipped', threads: { state: 'skipped' } })
    expect(w.threads.calls).toEqual([])
    expect(w.replies()).toEqual(['Skipped: you reacted ❌', 'Threads: omitido, reaccionaste ❌.'])
  })

  it('publishes Hoy at 11:30 with Threads auto on and does not approve Instagram', async () => {
    const w = new World()
    w.config.threads.enabled = w.config.threads.auto.hoy = true
    w.catalog = weekend().slice(0, 2).map(event => ({ ...event, startsAt: baInstant('2026-11-17', 20).toISOString() }))
    w.at('2026-11-17', 11, 20)
    await w.job().tick()
    expect(w.slackPosts[0]?.text).toContain('Threads (se publica solo a las 11:30 salvo que reacciones ❌):')
    expect(w.threads.calls).toEqual([])
    w.at('2026-11-17', 11, 30)
    await w.job().tick()
    expect(w.threads.posts).toHaveLength(1)
    expect(w.ig.published).toHaveLength(0)
    expect(w.job().loadDraft('hoy-2026-11-17')).toMatchObject({ state: 'previewed', threads: { state: 'published' } })
  })

  it.each(['published', 'unclear'])('rebuilds the Hoy Story after an afternoon cancellation with a %s Threads send', async mode => {
    const w = new World()
    const job = w.job()
    const date = '2026-11-17'
    const id = `hoy-${date}`
    w.config.threads.enabled = true
    w.catalog = weekend().slice(0, 3).map((event, i) => ({ ...event, startsAt: baInstant(date, 19 + i).toISOString() }))
    w.at(date, 11)
    await job.tick()
    w.approve()
    w.slackFails = 1
    w.slackFailPrefix = 'Threads:'
    if (mode === 'unclear') w.threads.publishFault = 'after'
    w.at(date, 11, 30)
    await job.tick()
    const original = job.loadDraft(id)!
    expect(original.threads?.state).toBe(mode === 'published' ? 'published' : 'publishing')
    expect(original.state).toBe('previewed')
    const cancelled = original.events[0]!
    w.statuses.set(cancelled.id, 'cancelled')
    w.config.slack.channel = 'C_TEST_MOVED'
    w.at(date, 13)
    const rebuilt = await job.regenerate(id, [cancelled.id])
    expect(rebuilt.revision).toBe(2)
    expect(rebuilt.events.map(event => event.id)).not.toContain(cancelled.id)
    expect(rebuilt.slack.ts).not.toBe(original.slack.ts)
    expect(rebuilt.slack.channel).toBe('C_TEST_MOVED')
    expect(rebuilt.threads).toEqual({ ...original.threads, threadTs: original.slack.ts, threadChannel: 'C0CG3EGKKP1' })
    const preview = w.slackPosts.filter(post => !post.threadTs).at(-1)!.text
    expect(preview).not.toContain('Threads (se publica')
    expect(preview).not.toContain(original.threads!.text)
    expect(preview.includes('Threads ya se publicó con la versión anterior.')).toBe(mode === 'published')
    w.slackFails = 0
    job.s.slackReactions = async ts => ts === original.slack.ts ? w.reactions : []
    await job.tick()
    expect(job.loadDraft(id)?.approvedSeenAt).toBeNull()
    expect(job.loadDraft(id)?.threads?.state).toBe('published')
    expect(w.slackCalls).toContainEqual({ method: 'chat.postMessage', text: `Threads: publicado ${w.threads.posts[0]!.permalink}`, ts: original.slack.ts, channel: 'C0CG3EGKKP1' })
    job.s.slackReactions = async ts => ts === rebuilt.slack.ts ? w.reactions : []
    w.at(date, 16, 50)
    await job.tick()
    w.at(date, 17)
    await job.tick()
    expect(job.loadDraft(id)?.state).toBe('published')
    expect(w.threads.calls.filter(call => call.startsWith('publish'))).toHaveLength(1)
  })

  it.each(['past cutoff', 'skipped', 'failed'])('does not promise Threads in an Instagram rebuild when Threads is %s', async phase => {
    const w = await threadsPreviewed()
    const job = w.job()
    const id = w.draft().id
    if (phase === 'past cutoff') {
      w.at('2026-11-20', 12, 5)
    } else if (phase === 'skipped') {
      w.reject()
      await job.tick()
      expect(w.draft().threads?.state).toBe('skipped')
      await expect(job.regenerate(id, [])).rejects.toThrow('a Slack reaction stopped the rebuild')
      w.reactions = [] // A manual rebuild is possible only after Hanif removes the veto.
    } else {
      w.config.r2 = null
      w.threads.atLimit = true
      w.approve()
      for (let i = 0; i < 6; i++) {
        w.at('2026-11-19', 12, 10 * i)
        await job.tick()
      }
      expect(w.draft().threads?.state).toBe('failed')
    }
    const original = w.draft()
    const rebuilt = await job.regenerate(id, [])
    const preview = w.slackPosts.filter(post => !post.threadTs).at(-1)!.text
    expect(preview).not.toContain('Threads')
    expect(rebuilt.threads).toEqual(original.threads)
    expect(rebuilt.slack.ts).not.toBe(original.slack.ts)
  })

  it('does not read Threads approval during six pre-slot Slack outages, then publishes on the noon ✅', async () => {
    const w = await threadsPreviewed()
    const job = w.job()
    let reads = 0
    job.s.slackReactions = async () => { reads++; throw new Error('Slack reactions.get failed') }
    for (let i = 0; i < 6; i++) {
      w.at('2026-11-19', 10, i * 10)
      await job.tick()
    }
    expect(reads).toBe(6) // Only Instagram checked before the slot.
    expect(w.draft().threads).toMatchObject({ state: 'waiting', failures: 0 })
    w.approve()
    job.s.slackReactions = async () => w.reactions
    w.at('2026-11-19', 12)
    await job.tick()
    expect(w.draft().threads?.state).toBe('published')
  })

  it('does not spend the Threads API retry budget on Slack reads at or after the slot', async () => {
    const w = await threadsPreviewed()
    const job = w.job()
    job.s.slackReactions = async () => { throw new Error('Slack reactions.get failed') }
    for (let i = 0; i < 6; i++) {
      w.at('2026-11-19', 12, i * 10)
      await job.tick()
    }
    expect(w.draft().threads).toMatchObject({ state: 'waiting', failures: 0 })
    w.approve()
    job.s.slackReactions = async () => w.reactions
    w.at('2026-11-19', 13)
    await job.tick()
    expect(w.draft().threads?.state).toBe('published')
  })

  it.each(['hoy', 'finde', 'gratis'] as const)('does not start %s Threads at its cutoff', async format => {
    const w = new World()
    const from = { hoy: '2026-11-17', finde: '2026-11-20', gratis: '2026-11-16' }[format]
    w.config.threads.enabled = true
    const eventDay = format === 'gratis' ? addDays(from, 1) : from
    w.catalog = weekend().map(event => ({ ...event, isFree: true, startsAt: baInstant(eventDay, 21).toISOString() }))
    w.at(from, 11)
    const job = w.job()
    const draft = await job.createDraft(format, from, [], 1)
    // No new runs to draft during the cutoff check.
    job.s.readCatalog = async () => []
    w.approve()
    w.at(eventDay, format === 'hoy' ? 17 : 12)
    await job.tick()
    expect(w.job().loadDraft(draft.id)?.threads?.state).toBe('skipped')
    expect(w.threads.calls).toEqual([])
    expect(w.replies()).toContain(`Threads: omitido, no se publicó antes de las ${format === 'hoy' ? '17:00' : '12:00'}.`)
  })

  it('keeps a slow container, then checks fresh reactions and cutoff after the publishing-limit read', async () => {
    const w = await threadsPreviewed()
    w.approve()
    w.threads.containerStatus = 'IN_PROGRESS'
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.draft().threads).toMatchObject({ state: 'publishing', containerId: 'c1', failures: 0, attemptedAt: null })
    w.threads.containerStatus = 'FINISHED'
    w.threads.checkLimit = async () => { w.reactions = [] }
    await w.job().tick()
    expect(w.threads.posts).toHaveLength(0)
    w.approve()
    w.threads.checkLimit = async () => { w.at('2026-11-20', 12) }
    await w.job().tick()
    expect(w.draft().threads?.state).toBe('skipped')
    expect(w.threads.posts).toHaveLength(0)
    expect(w.threads.calls.filter(call => call === 'create')).toHaveLength(1)
  })

  it('does not create a Threads container if disabled during the quota check', async () => {
    const w = await threadsPreviewed()
    const checkLimit = w.threads.checkLimit.bind(w.threads)
    w.threads.checkLimit = async () => {
      await checkLimit()
      w.config.threads.enabled = false
    }
    w.approve()
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.threads.calls).toEqual(['limit'])
    expect(w.draft().threads).toMatchObject({ state: 'waiting', containerId: null, attemptedAt: null, failures: 0 })
  })

  it('pauses a saved container when Threads is disabled during status polling and reuses it once enabled', async () => {
    const w = await threadsPreviewed()
    const status = w.threads.status.bind(w.threads)
    w.threads.status = async id => {
      const result = await status(id)
      w.config.threads.enabled = false
      return result
    }
    w.approve()
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.threads.calls).toEqual(['limit', 'create', 'status c1'])
    expect(w.threads.posts).toHaveLength(0)
    expect(w.draft().threads).toMatchObject({ state: 'publishing', containerId: 'c1', attemptedAt: null, failures: 0 })

    await w.job().tick()
    expect(w.threads.calls).toHaveLength(3)
    w.threads.status = status
    w.config.threads.enabled = true
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.threads.calls.slice(3)).toEqual(['status c1', 'limit', 'recent', 'publish c1', 'permalink m2'])
    expect(w.draft().threads).toMatchObject({ state: 'published', containerId: 'c1', mediaId: 'm2' })
  })

  it.each([true, false])('holds a cancelled pick before any Threads write (Instagram can write: %s)', async instagramAvailable => {
    const w = await threadsPreviewed()
    if (!instagramAvailable) w.config.r2 = null
    const event = w.draft().events[0]!
    w.statuses.set(event.id, 'cancelled')
    w.approve()
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.draft().state).toBe(instagramAvailable ? 'held' : 'previewed')
    expect(w.draft().threads?.state).toBe('held')
    expect(w.threads.calls).toEqual([])
    expect(w.replies()).toContain(`Threads: retenido, ${event.title} cambió (se canceló, ya pasó o salió de la agenda).`)
  })

  it('recovers an unclear publish by exact later text after ❌ and cutoff, without a second write', async () => {
    const w = await threadsPreviewed()
    const text = w.draft().threads!.text!
    w.threads.publishFault = 'after'
    w.approve()
    w.at('2026-11-19', 12)
    w.threads.post(text, w.clock.getTime() - 1000)
    await w.job().tick()
    const ownedId = w.threads.posts[0]!.id
    expect(w.draft().threads).toMatchObject({ mediaId: null, attemptedAt: w.clock.toISOString(), containerId: expect.any(String) })
    w.threads.post(`${text}!`)
    w.reject()
    w.at('2026-11-20', 12)
    await w.job().tick()
    expect(w.draft().threads).toMatchObject({ state: 'published', mediaId: ownedId })
    expect(w.threads.calls.filter(call => call.startsWith('publish'))).toHaveLength(1)
  })

  it('reconciles a same-second fake send after an unknown Graph error, excluding the pre-dispatch identical post', async () => {
    const w = await threadsPreviewed()
    const text = w.draft().threads!.text!
    w.approve()
    w.at('2026-11-19', 12)
    const existing = w.threads.post(text, w.clock.getTime())
    w.clock = new Date(w.clock.getTime() + 650)
    w.threads.clock = w.clock.getTime()
    const graphWrites: string[] = []
    const client = await threadsApi('synthetic', async (_url, request) => {
      if (request?.method === 'GET') return Response.json({ id: '42', username: 'baeventos.app' })
      graphWrites.push(String(request?.body))
      w.threads.post(text) // Graph sends successfully but returns a generic error to the caller.
      return Response.json({ error: { code: 1, message: 'An unknown error occurred' } }, { status: 400 })
    })
    w.threads.publish = client.publish
    await w.job().tick()
    const ownPost = w.threads.posts[0]!
    const canonicalTimestamp = ownPost.timestamp!
    expect(Date.parse(canonicalTimestamp)).toBe(Math.floor(w.clock.getTime() / 1000) * 1000)
    ownPost.timestamp = '2026-11-19T15:00:00+0000' // Graph's compact offset, not canonical ISO.
    expect(w.draft().threads).toMatchObject({ attemptedAt: w.clock.toISOString(), beforeIds: [existing], mediaId: null })
    w.at('2026-11-19', 12, 10)
    await w.job().tick()
    expect(w.draft().threads).toMatchObject({ state: 'published', mediaId: ownPost.id, publishedAt: canonicalTimestamp })
    const report = await threadsReport(w.job().allDrafts(), w.threads, w.clock, 28)
    expect(report).toContain('2026-11-19\tfinde\t')
    expect(graphWrites).toEqual(['creation_id=c2'])
  })

  it('never adopts a different post by time or a pre-dispatch exact match, and does not blindly retry', async () => {
    const w = await threadsPreviewed()
    w.threads.publishFault = 'before'
    w.approve()
    w.at('2026-11-19', 12)
    w.threads.post(w.draft().threads!.text!, w.clock.getTime())
    await w.job().tick()
    w.threads.post('Publicación manual')
    w.reactions = []
    w.at('2026-11-20', 12)
    await w.job().tick()
    expect(w.draft().threads).toMatchObject({ state: 'failed', mediaId: null })
    expect(w.threads.calls.filter(call => call.startsWith('publish'))).toHaveLength(1)
    expect(w.replies()).toContain('Threads: falló (no se pudo confirmar la publicación). Hermes lo revisa.')
    expect(w.alerts).toContainEqual(expect.objectContaining({ key: 'draft/finde-2026-11-20/threads', text: expect.stringContaining('could not confirm') }))
  })

  it('keeps a Threads failure alert pending until the alert command reports success', async () => {
    const w = await threadsPreviewed()
    const job = w.job()
    const alert = job.s.alert
    let raises = 0
    job.s.alert = async (key, ...args) => {
      if (key.endsWith('/threads') && ++raises === 1) return false
      await alert(key, ...args)
      return true
    }
    w.threads.atLimit = true
    w.config.r2 = null
    w.approve()
    for (let i = 0; i < 6; i++) {
      w.at('2026-11-19', 12, 10 * i)
      await job.tick()
    }
    expect(w.draft().threads?.state).toBe('failed')
    expect(w.draft().threads?.failureAlertSent).not.toBe(true)
    expect(raises).toBe(1)
    w.at('2026-11-19', 13)
    await job.tick()
    expect(w.draft().threads?.failureAlertSent).toBe(true)
    expect(raises).toBe(2)
    await job.tick()
    expect(raises).toBe(2)
  })

  it('saves IDs across a definite publish rejection and a subsequent permalink failure', async () => {
    const w = await threadsPreviewed()
    const publish = w.threads.publish.bind(w.threads)
    w.threads.publish = async id => {
      expect(w.draft().threads).toMatchObject({ containerId: id, attemptedAt: w.clock.toISOString() })
      return publish(id)
    }
    w.approve()
    w.at('2026-11-19', 12)
    w.threads.publishFault = 'rejected'
    await w.job().tick()
    expect(w.draft().threads).toMatchObject({ containerId: 'c1', mediaId: null, attemptedAt: null })
    w.threads.publishFault = null
    w.threads.permalinkUnavailable = true
    await w.job().tick()
    expect(w.draft().threads).toMatchObject({ containerId: 'c1', mediaId: 'm2', permalink: null })
    w.threads.permalinkUnavailable = false
    w.reactions = []
    await w.job().tick()
    expect(w.draft().threads?.state).toBe('published')
    expect(w.threads.calls.filter(call => call.startsWith('publish'))).toEqual(['publish c1', 'publish c1'])
    expect(w.threads.posts).toHaveLength(1)
  })

  it('checks quota before creating a Threads container without blocking Instagram', async () => {
    const w = await threadsPreviewed()
    w.threads.atLimit = true
    w.approve()
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.draft()).toMatchObject({ state: 'published', threads: { state: 'waiting', containerId: null, failures: 1 } })
    expect(w.threads.calls).toEqual(['limit'])
    w.threads.atLimit = false
    await w.job().tick()
    expect(w.draft().threads?.state).toBe('published')
    expect(w.threads.calls.filter(call => call === 'create')).toHaveLength(1)
  })

  it('publishes Threads through Instagram and Slack failures without resending the post', async () => {
    const w = await threadsPreviewed()
    w.ig.publishFault = 'before'
    w.slackFails = 1
    w.slackFailPrefix = 'Threads:'
    w.threadsWarning = 'Could not refresh the Threads token.'
    w.approve()
    w.at('2026-11-19', 12)
    await w.job().tick()
    expect(w.ig.published).toHaveLength(0)
    expect(w.alerts).toContainEqual(expect.objectContaining({ key: 'threads-token' }))
    expect(w.draft().threads).toMatchObject({ state: 'published', notify: expect.stringContaining('Threads: publicado') })
    await w.job().tick()
    expect(w.draft().threads?.notify).toBeNull()
    expect(w.threads.posts).toHaveLength(1)
  })

  it('never contacts Threads when disabled and never backfills one of those previews', async () => {
    const w = await previewed()
    w.at('2026-11-19', 12)
    w.approve()
    await w.job().tick()
    expect(w.slackPosts.every(post => !post.text.includes('Threads'))).toBe(true)
    expect(w.draft().threads).toBeUndefined()
    expect(w.threadsTokenReads).toBe(0)
    expect(w.threadsConnections).toBe(0)
    w.config.threads.enabled = true
    await w.job().tick()
    expect(w.draft().threads).toBeUndefined()
    expect(w.threadsConnections).toBe(0)
    w.at('2026-11-19', 18)
    await w.job().tick()
    expect(w.reel()?.threads).toBeUndefined()
  })
})

const titles = ['LA NOCHE DE LOS FAROLES @ Sala Jacarandá', 'Cuarteto del Patio', 'Obra breve: Un mapa de la lluvia', 'Cineclub: La Casa del Viento', 'Taller de fanzines y collage', 'Lecturas junto al río']
const venues = ['Sala Jacarandá', 'Club del Patio', 'La Linterna', 'Cine La Vuelta', 'Casa Aguafuerte', 'Biblioteca del Pasaje']

describe('Threads fixture dry runs', () => {
  it.each(['hoy', 'finde', 'gratis'] as const)('writes the exact %s Threads text from a synthetic catalog', async format => {
    const w = new World()
    const from = { hoy: '2026-11-21', finde: '2026-11-20', gratis: '2026-11-16' }[format]
    const long = ' — piezas inéditas para escuchar de cerca en una noche de encuentros entre artistas y vecinos del barrio'.repeat(2)
    w.catalog = weekend().map((event, i) => ({
      ...event, name: format === 'finde' ? `${titles[i]!.split(' @ ')[0]}${long}` : titles[i]!, venue: venues[i]!,
      startsAt: baInstant(addDays(from, format === 'hoy' ? 0 : i % 3), 18 + i, 30).toISOString(),
      isFree: format === 'gratis' || i === 0, price: i === 1 ? 12000 : null, payWhatYouWant: i === 2,
    }))
    w.config.threads.enabled = format !== 'hoy'
    const out = join(w.dir, 'dry-run')
    await dryRun(format, from, out, { threads: format === 'hoy', job: w.job() })
    const text = readFileSync(join(out, 'threads.txt'), 'utf8')
    expect([...text].length).toBeLessThanOrEqual(500)
    if (format === 'finde') {
      expect(text).toContain('3 planes')
      expect(text.match(/…/g)).toHaveLength(3)
    }
    await expect(text).toMatchFileSnapshot(`./fixtures/threads/${format}/threads.txt`)
    expect(w.threadsTokenReads).toBe(0)
    expect(w.threadsConnections).toBe(0)
    expect(w.slackPosts).toHaveLength(0)
  })
})
