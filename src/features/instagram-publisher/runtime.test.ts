import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, utimesSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWindow } from './formats.ts'
import { DEFAULT_REVIEW, alert, catalogSql, loadToken, mediaBin, readConfig, renderFrames, renderReel, slackPermalink, slackPost, slackReviewReceipt, toCatalogEvent, type Runner } from './runtime.ts'
import { reelTiming } from './reel/project.ts'

describe('publisher config', () => {
  it('defaults approval previews to #alerts and honors a configured channel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-config-'))
    try {
      const path = join(dir, 'publisher.json')
      expect(readConfig(path).slack.channel).toBe('C0CG3EGKKP1')
      writeFileSync(path, JSON.stringify({ slack: { channel: ' C_APPROVALS ' } }))
      expect(readConfig(path).slack.channel).toBe('C_APPROVALS')
      writeFileSync(path, JSON.stringify({ slack: { channel: ' ' } }))
      expect(readConfig(path).slack.channel).toBe('C0CG3EGKKP1')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it.each([
    { bucket: '', publicBaseUrl: 'https://media.example.com' },
    { bucket: ' \t ', publicBaseUrl: 'https://media.example.com' },
    { bucket: 'test-media', publicBaseUrl: '' },
    { bucket: 'test-media', publicBaseUrl: ' \n ' },
    { bucket: 'test-media', publicBaseUrl: ' / ' },
  ])('stays preview-only with incomplete R2 config: %j', r2 => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-config-'))
    try {
      const path = join(dir, 'publisher.json')
      writeFileSync(path, JSON.stringify({ linkStickers: { hoy: true }, r2 }))
      expect(readConfig(path)).toMatchObject({ linkStickers: { hoy: true }, r2: null })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('defaults the reviewer and expands a configured key file without changing the other settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-config-'))
    try {
      const path = join(dir, 'publisher.json')
      expect(readConfig(path).review).toEqual(DEFAULT_REVIEW)
      writeFileSync(path, JSON.stringify({ review: { model: ' test-model ', keyFile: '~/keys/review' }, auto: { hoy: true } }))
      expect(readConfig(path)).toMatchObject({ review: { model: 'test-model', keyFile: join(homedir(), 'keys/review') }, auto: { hoy: true } })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('trims a configured bucket and public URL before use', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-config-'))
    try {
      const path = join(dir, 'publisher.json')
      writeFileSync(path, '{"r2":{"bucket":" test-media ","publicBaseUrl":" https://media.example.com/ "}}')
      expect(readConfig(path).r2).toEqual({ bucket: 'test-media', publicBaseUrl: 'https://media.example.com' })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('alert command', () => {
  it.each([0, 1, null])('reports success only on exit 0 (exit %s)', async code => {
    const runner: Runner = async argv => {
      expect(argv.slice(1, 3)).toEqual(['raise', 'ba-events/instagram/draft/test/threads'])
      return { out: '', err: 'fake alert command result', code }
    }
    expect(await alert('draft/test/threads', 'Title', 'Body', undefined, runner)).toBe(code === 0)
  })
})

it.each([
  { name: 'thread reply', threadTs: '1.0', broadcast: false, fields: { thread_ts: '1.0' } },
  { name: 'thread broadcast', threadTs: '1.0', broadcast: true, fields: { thread_ts: '1.0', reply_broadcast: 'true' } },
  { name: 'top-level notice', threadTs: null, broadcast: false, fields: {} },
])('posts a Slack $name with only its required fields', async ({ threadTs, broadcast, fields }) => {
  const text = 'Is the show at 21:00? React on the Slack preview.'
  const call = async (method: string, payload: Record<string, string>) => {
    expect(method).toBe('chat.postMessage')
    expect(payload).toEqual({ channel: 'C_APPROVALS', text, unfurl_links: 'false', ...fields })
    return { ts: '2.0' }
  }
  expect(await slackPost(text, threadTs, 'C_APPROVALS', broadcast, call)).toEqual({ ts: '2.0' })
})

it('persists a Slack part identifier on the write and reconciles it across read pages', async () => {
  const receipt = { id: 'seeded-id', since: 100_000 }
  let metadata: unknown
  await slackPost('Continuation', '1.0', 'C_ALERTS', false, async (_method, payload) => {
    metadata = JSON.parse(payload.metadata!)
    return { ts: '2.0' }
  }, receipt)
  expect(metadata).toEqual({ event_type: 'ba_eventos_review_part', event_payload: { id: receipt.id } })
  const calls: Array<string | undefined> = []
  expect(await slackReviewReceipt('C_ALERTS', '1.0', receipt, async (method, payload) => {
    expect(method).toBe('conversations.replies')
    expect(payload).toMatchObject({ ts: '1.0', channel: 'C_ALERTS', oldest: '40', include_all_metadata: 'true' })
    calls.push(payload.cursor)
    return payload.cursor ? { messages: [{ ts: '2.0', metadata }] } : { messages: [], response_metadata: { next_cursor: 'next' } }
  })).toBe('2.0')
  expect(calls).toEqual([undefined, 'next'])
  await expect(slackReviewReceipt('C_ALERTS', null, receipt, async method => {
    expect(method).toBe('conversations.history')
    return { messages: [], has_more: true }
  })).rejects.toThrow('did not finish')
})

it('looks up the preview permalink by channel and message timestamp', async () => {
  const permalink = 'https://test-workspace.slack.com/archives/C_APPROVALS/p10'
  const call = async (method: string, payload: Record<string, string>) => {
    expect(method).toBe('chat.getPermalink')
    expect(payload).toEqual({ channel: 'C_APPROVALS', message_ts: '1.0' })
    return { permalink }
  }
  expect(await slackPermalink('1.0', 'C_APPROVALS', call)).toBe(permalink)
})

describe('catalog read', () => {
  it('is one read-only SELECT over the run window, intake events only', () => {
    const sql = catalogSql(runWindow('finde', '2026-11-20'))
    expect(sql.trimStart()).toMatch(/^SELECT/)
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|replace|attach|pragma)\b/i)
    expect(sql).toContain("e.starts_at >= '2026-11-20T03:00:00.000Z' AND e.starts_at < '2026-11-23T03:00:00.000Z'")
    expect(sql).toContain('event_source_evidence')
    expect(sql).toContain('e.image_url')
    expect(sql).toContain("json_extract(c.payload, '$.intent') <> 'link'")
  })

  it('reads pay-what-you-want from the intake price note', () => {
    const row = { id: 'a', name: 'x', starts_at: '2026-11-21T00:00:00.000Z', status: 'scheduled', is_free: 0, time_tba: 0, is_all_day: 0, categories: '["music"]' }
    expect(toCatalogEvent({ ...row, price_note: 'A la gorra, con reserva previa.' }).payWhatYouWant).toBe(true)
    expect(toCatalogEvent({ ...row, price_note: 'A contribución consciente, sugerido $8000.' }).payWhatYouWant).toBe(true)
    expect(toCatalogEvent({ ...row, price_note: 'Gratis con inscripción.' }).payWhatYouWant).toBe(false)
    expect(toCatalogEvent(row).categories).toEqual(['music'])
    expect(toCatalogEvent(row).imageUrl).toBeNull()
    expect(toCatalogEvent({ ...row, image_url: 'https://baeventos.com/api/event-artwork/a/b.webp' }).imageUrl).toBe('https://baeventos.com/api/event-artwork/a/b.webp')
  })
})

describe('Instagram token', () => {
  const now = new Date('2026-11-20T12:00:00.000Z')
  const tokenFile = (token: object, ageDays: number) => {
    const file = join(mkdtempSync(join(tmpdir(), 'ig-token-')), 'instagram-token.json')
    writeFileSync(file, JSON.stringify(token), { mode: 0o600 })
    const at = (now.getTime() - ageDays * 86_400_000) / 1000
    utimesSync(file, at, at)
    return file
  }
  const fresh = { access_token: 'SECRET-1', ig_user_id: '17841', expires_at: '2027-01-10T00:00:00.000Z' }

  it('says missing when there is no file', async () => {
    expect(await loadToken(now, fetch, '/nonexistent/instagram-token.json')).toEqual({ state: 'missing' })
  })

  it('never refreshes or warns about a system-user token that never expires', async () => {
    const file = tokenFile({ ...fresh, expires_at: 'never' }, 400)
    const check = await loadToken(now, (() => { throw new Error('no fetch expected') }) as unknown as typeof fetch, file)
    expect(check).toMatchObject({ state: 'ok', warning: null })
  })

  it('leaves a token under 7 days old alone', async () => {
    const file = tokenFile(fresh, 3)
    const check = await loadToken(now, (() => { throw new Error('no fetch expected') }) as unknown as typeof fetch, file)
    expect(check).toMatchObject({ state: 'ok', warning: null })
  })

  it('refreshes an older token and writes it back with mode 600', async () => {
    const file = tokenFile(fresh, 8)
    let asked = ''
    const fake = (async (url: string) => { asked = url; return new Response(JSON.stringify({ access_token: 'SECRET-2', expires_in: 60 * 86_400 })) }) as unknown as typeof fetch
    const check = await loadToken(now, fake, file)
    expect(asked).toContain('grant_type=ig_refresh_token')
    expect(check).toMatchObject({ state: 'ok', warning: null })
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written).toMatchObject({ access_token: 'SECRET-2', ig_user_id: '17841', refreshed_at: now.toISOString() })
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('warns, without the token, when a refresh fails or fewer than 10 days remain', async () => {
    const failing = (async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth' } }), { status: 400 })) as unknown as typeof fetch
    const failed = await loadToken(now, failing, tokenFile(fresh, 8))
    expect(failed.state === 'ok' && failed.warning).toMatch(/refresh failed: Invalid OAuth/)
    const soon = await loadToken(now, fetch, tokenFile({ ...fresh, expires_at: '2026-11-25T00:00:00.000Z' }, 1))
    expect(soon.state === 'ok' && soon.warning).toMatch(/expires in 4 days/)
    expect(JSON.stringify([failed, soon].map(check => check.state === 'ok' && check.warning))).not.toContain('SECRET')
  })
})

describe('rendering', () => {
  it('stops the whole named scope when the render times out', async () => {
    const calls: string[][] = []
    const runner: Runner = async argv => { calls.push(argv); return argv[0] === 'systemd-run' ? { out: '', err: '', code: null } : { out: '', err: '', code: 0 } }
    const out = mkdtempSync(join(tmpdir(), 'ig-render-'))
    await expect(renderFrames('<html></html>', out, 1350, runner)).rejects.toThrow(/timed out/)
    const unit = calls[0]!.find(arg => arg.startsWith('--unit='))!.slice('--unit='.length)
    expect(calls[0]).toEqual(expect.arrayContaining(['-p', 'MemoryMax=900M', 'MemorySwapMax=0', 'RuntimeMaxSec=170']))
    expect(calls[1]).toEqual(['systemctl', '--user', 'stop', `${unit}.scope`])
  })

  it('passes Node flags to the child and leaves the scope alone after a clean render', async () => {
    const calls: string[][] = []
    const runner: Runner = async argv => { calls.push(argv); return { out: '', err: '', code: 0 } }
    const args = process.execArgv
    process.execArgv = [...args, '--experimental-transform-types']
    try {
      await renderFrames('<html></html>', mkdtempSync(join(tmpdir(), 'ig-render-')), 1350, runner)
      expect(calls).toHaveLength(1)
      const start = calls[0]!.indexOf(process.execPath)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(calls[0]!.slice(start + 1, calls[0]!.indexOf('render-frames') - 1)).toEqual(process.execArgv)
    } finally { process.execArgv = args }
  })
})

describe('Reel rendering', () => {
  const events = [1, 2, 3, 4].map(n => ({ id: `${n}`, date: '2026-11-21', startsAt: '', title: 'T', time: '21:00', description: null, venue: `V${n}`, barrio: 'B', price: null, handle: null, artworkRef: null, via: false }))
  const window = { from: '2026-11-20', to: '2026-11-22' } as never
  const timing = reelTiming(window, events, 120)
  const track = { id: 't', title: 't', artist: 'a', file: 'x.flac', durationSec: 40, bpm: 120, startSec: 0, credit: null, path: '/nonexistent/x.flac' }

  it('fails, naming the install command, when HyperFrames\' managed Chrome is missing', async () => {
    const calls: string[][] = []
    const runner: Runner = async argv => { calls.push(argv); return { out: '', err: '', code: 0 } }
    await expect(renderReel(window, events, timing, track, mkdtempSync(join(tmpdir(), 'reel-')), {}, runner, '/nonexistent/chrome'))
      .rejects.toThrow(/managed Chrome is missing.*npx --yes hyperframes@0\.9\.66 browser ensure/)
    expect(calls).toEqual([])
  })

  const ffmpeg = (() => { try { return mediaBin('ffmpeg') } catch { return null } })()

  it('removes the project when the excerpt itself fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reel-excerpt-'))
    const chrome = join(dir, 'chrome/linux-1/chrome-headless-shell-linux64')
    const { mkdirSync, existsSync } = await import('node:fs')
    mkdirSync(chrome, { recursive: true })
    writeFileSync(join(chrome, 'chrome-headless-shell'), '')
    await expect(renderReel(window, events, timing, track, join(dir, 'out'), {}, async () => ({ out: '', err: '', code: 0 }), join(dir, 'chrome'))).rejects.toThrow()
    expect(existsSync(join(dir, 'out/project'))).toBe(false)
  })

  it.skipIf(!ffmpeg)('fails the Reel when a card reported that it could not be laid out, even though a video was written', async () => {
    const { spawnSync } = await import('node:child_process')
    const { mkdirSync, existsSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'reel-font-'))
    const chrome = join(dir, 'chrome/linux-1/chrome-headless-shell-linux64')
    mkdirSync(chrome, { recursive: true })
    writeFileSync(join(chrome, 'chrome-headless-shell'), '')
    const music = join(dir, 'tone.flac')
    spawnSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=40:r=48000', music])
    const runner: Runner = async argv => {
      if (argv.includes('render')) writeFileSync(argv[argv.indexOf('-o') + 1]!, 'video')
      return { out: '', err: '[Browser:ERROR] BA_REEL_CARD_FAILED: e2: A font file did not load\nmore output', code: 0 }
    }
    process.env.BA_INSTAGRAM_RENDER_NO_SCOPE = '1'
    try {
      await expect(renderReel(window, events, timing, { ...track, path: music }, join(dir, 'out'), {}, runner, join(dir, 'chrome')))
        .rejects.toThrow('Rendering the Reel failed: BA_REEL_CARD_FAILED: e2: A font file did not load')
    } finally { delete process.env.BA_INSTAGRAM_RENDER_NO_SCOPE }
    expect(existsSync(join(dir, 'out/reel.mp4'))).toBe(false)
    expect(existsSync(join(dir, 'out/render.mp4'))).toBe(false)
  }, 60_000)

  // The excerpt runs before the render and needs ffmpeg; runners without it skip this test.
  it.skipIf(!ffmpeg)('renders under the 1000 MB scope with one worker and stops the scope on failure', async () => {
    const { spawnSync } = await import('node:child_process')
    const dir = mkdtempSync(join(tmpdir(), 'reel-render-'))
    const chrome = join(dir, 'chrome/linux-1/chrome-headless-shell-linux64')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(chrome, { recursive: true })
    writeFileSync(join(chrome, 'chrome-headless-shell'), '')
    const music = join(dir, 'tone.flac')
    spawnSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=40:r=48000', music])
    const calls: string[][] = []
    const runner: Runner = async argv => { calls.push(argv); return { out: '', err: 'boom', code: argv[0] === 'systemd-run' ? 1 : 0 } }
    await expect(renderReel(window, events, timing, { ...track, path: music }, join(dir, 'out'), {}, runner, join(dir, 'chrome')))
      .rejects.toThrow(/Rendering the Reel failed \(exit 1\)/)
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(dir, 'out/project'))).toBe(false) // the audio excerpt doesn't outlive a failed render
    expect(calls[0]).toEqual(expect.arrayContaining(['--scope', '--collect', '-p', 'MemoryMax=1000M', 'MemorySwapMax=0', 'RuntimeMaxSec=600', 'npx', '--yes', 'hyperframes@0.9.66', 'render', '--quality', 'delivery', '--workers', '1']))
    const unit = calls[0]!.find(arg => arg.startsWith('--unit='))!.slice('--unit='.length)
    expect(unit).toMatch(/^ba-events-instagram-reel-\d+-\d+$/)
    expect(calls[1]).toEqual(['systemctl', '--user', 'stop', `${unit}.scope`])
  }, 60_000)
})
