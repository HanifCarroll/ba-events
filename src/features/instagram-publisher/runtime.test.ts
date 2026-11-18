import { mkdtempSync, readFileSync, statSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWindow } from './formats.ts'
import { catalogSql, loadToken, renderFrames, renderReel, toCatalogEvent, type Runner } from './runtime.ts'
import { reelTiming } from './reel/project.ts'

describe('catalog read', () => {
  it('is one read-only SELECT over the run window, intake events only', () => {
    const sql = catalogSql(runWindow('finde', '2026-11-20'))
    expect(sql.trimStart()).toMatch(/^SELECT/)
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|replace|attach|pragma)\b/i)
    expect(sql).toContain("e.starts_at >= '2026-11-20T03:00:00.000Z' AND e.starts_at < '2026-11-23T03:00:00.000Z'")
    expect(sql).toContain('event_source_evidence')
    expect(sql).toContain("json_extract(c.payload, '$.intent') <> 'link'")
  })

  it('reads pay-what-you-want from the intake price note', () => {
    const row = { id: 'a', name: 'x', starts_at: '2026-11-21T00:00:00.000Z', status: 'scheduled', is_free: 0, time_tba: 0, is_all_day: 0, categories: '["music"]' }
    expect(toCatalogEvent({ ...row, price_note: 'A la gorra, con reserva previa.' }).payWhatYouWant).toBe(true)
    expect(toCatalogEvent({ ...row, price_note: 'A contribución consciente, sugerido $8000.' }).payWhatYouWant).toBe(true)
    expect(toCatalogEvent({ ...row, price_note: 'Gratis con inscripción.' }).payWhatYouWant).toBe(false)
    expect(toCatalogEvent(row).categories).toEqual(['music'])
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

  it('leaves the scope alone after a clean render', async () => {
    const calls: string[][] = []
    const runner: Runner = async argv => { calls.push(argv); return { out: '', err: '', code: 0 } }
    await renderFrames('<html></html>', mkdtempSync(join(tmpdir(), 'ig-render-')), 1350, runner)
    expect(calls).toHaveLength(1)
  })
})

describe('Reel rendering', () => {
  const events = [1, 2, 3, 4].map(n => ({ id: `${n}`, date: '2026-11-21', startsAt: '', title: 'T', time: '21:00', description: null, venue: `V${n}`, barrio: 'B', price: null, handle: null, via: false }))
  const window = { from: '2026-11-20', to: '2026-11-22' } as never
  const timing = reelTiming(window, events, 120)
  const track = { id: 't', title: 't', artist: 'a', file: 'x.flac', durationSec: 40, bpm: 120, startSec: 0, credit: null, path: '/nonexistent/x.flac' }

  it('fails, naming the install command, when HyperFrames\' managed Chrome is missing', async () => {
    const calls: string[][] = []
    const runner: Runner = async argv => { calls.push(argv); return { out: '', err: '', code: 0 } }
    await expect(renderReel(window, events, timing, track, mkdtempSync(join(tmpdir(), 'reel-')), runner, '/nonexistent/chrome'))
      .rejects.toThrow(/managed Chrome is missing.*npx --yes hyperframes@0\.9\.66 browser ensure/)
    expect(calls).toEqual([])
  })

  it('renders under the 1000 MB scope with one worker and stops the scope on failure', async () => {
    const { spawnSync } = await import('node:child_process')
    const { mediaBin } = await import('./runtime.ts')
    let ffmpeg: string
    try { ffmpeg = mediaBin('ffmpeg') } catch { return } // the excerpt needs ffmpeg; CI runners without it skip
    const dir = mkdtempSync(join(tmpdir(), 'reel-render-'))
    const chrome = join(dir, 'chrome/linux-1/chrome-headless-shell-linux64')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(chrome, { recursive: true })
    writeFileSync(join(chrome, 'chrome-headless-shell'), '')
    const music = join(dir, 'tone.flac')
    spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=40:r=48000', music])
    const calls: string[][] = []
    const runner: Runner = async argv => { calls.push(argv); return { out: '', err: 'boom', code: argv[0] === 'systemd-run' ? 1 : 0 } }
    await expect(renderReel(window, events, timing, { ...track, path: music }, join(dir, 'out'), runner, join(dir, 'chrome')))
      .rejects.toThrow(/Rendering the Reel failed \(exit 1\)/)
    expect(calls[0]).toEqual(expect.arrayContaining(['--scope', '--collect', '-p', 'MemoryMax=1000M', 'MemorySwapMax=0', 'RuntimeMaxSec=600', 'npx', '--yes', 'hyperframes@0.9.66', 'render', '--quality', 'delivery', '--workers', '1']))
    const unit = calls[0]!.find(arg => arg.startsWith('--unit='))!.slice('--unit='.length)
    expect(unit).toMatch(/^ba-events-instagram-reel-\d+-\d+$/)
    expect(calls[1]).toEqual(['systemctl', '--user', 'stop', `${unit}.scope`])
  }, 60_000)
})
