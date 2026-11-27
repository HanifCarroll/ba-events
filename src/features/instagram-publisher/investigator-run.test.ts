import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { recordDelegatedVeto } from './delegation.ts'
import { endTime, type InvestigationRequest } from './investigation.ts'
import { startInvestigator } from './investigator-run.ts'
import { publicResearchUrl } from './investigator-web.ts'

function invokeTool(action: string, data: string, env: NodeJS.ProcessEnv = {}) {
  const tool = new URL('../../../scripts/publisher-investigator/tools.mjs', import.meta.url)
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import register from ${JSON.stringify(tool.href)}
    register({ async registerTool(tool) {
      const [action, data] = process.argv.slice(1)
      console.log(JSON.stringify((await tool.execute('test', { action, data })).content))
    } })
  `, '--', action, data], { encoding: 'utf8', timeout: 4_000, env }))
}

it('names the data field and its limit when the adapter rejects oversized input', () => {
  expect(invokeTool('finish', 'a'.repeat(12_001)))
    .toEqual([{ type: 'text', text: 'data must be at most 12,000 characters.' }])
})

it('explains the catalog-fix JSON shape without echoing malformed input', () => {
  for (const data of ['{"id":"/synthetic/private/file"', '[]', 'null']) {
    expect(invokeTool('catalog-fix', data))
      .toEqual([{ type: 'text', text: 'data must be a JSON object with id, field, from, to, and evidence (and optional allOccurrences).' }])
  }
})

it('launches a detached transient user service with the remaining budget and a hard memory cap', async () => {
  const startsAt = Date.now()
  const cutoff = new Date(startsAt + 25 * 60_000)
  const request: InvestigationRequest = {
    id: 'hoy-2026-11-25', revision: 1, startsAt, endsAt: endTime(startsAt, cutoff), cutoff: cutoff.toISOString(), slot: cutoff.toISOString(),
    copyHash: 'copy', framesHash: 'frames', input: { format: 'hoy', from: '2026-11-25', to: '2026-11-25',
      caption: null, threads: null, events: [], frames: [] }, events: [],
  }
  expect(request.endsAt - startsAt).toBe(5 * 60_000)
  const run = vi.fn(async (_argv: string[], _timeout: number) => ({ out: '', err: '', code: 0 }))
  await startInvestigator(request, '/private/synthetic-run', run)
  const [argv, timeout] = run.mock.calls[0]!
  expect(argv).toEqual(expect.arrayContaining(['systemd-run', '--user', '--collect', 'MemoryMax=1000M', 'MemorySwapMax=0', 'investigator-run', '/private/synthetic-run']))
  expect(argv).not.toContain('--wait')
  expect(argv.find(arg => arg.startsWith('RuntimeMaxSec='))).toMatch(/^RuntimeMaxSec=(29\d|300)$/u)
  expect(timeout).toBeLessThan(10_000)
})

it('returns a safe finish validation message and accepts a corrected finding', () => {
  const state = mkdtempSync(join(tmpdir(), 'publisher-investigation-'))
  try {
    const id = 'hoy-2026-11-25'
    const eventId = '10000000-0000-4000-8000-000000000001'
    const dir = join(state, 'drafts', id, 'investigation-1')
    const startsAt = Date.now()
    const request = { id, revision: 1, startsAt, endsAt: startsAt + 60_000, framesHash: 'frames',
      copyHash: 'copy', events: [{ id: eventId }] }
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'request.json'), JSON.stringify(request))
    const draftFile = join(state, 'drafts', `${id}.json`)
    const draft = { revision: 1, state: 'previewed', framesHash: 'frames', review: { investigation: { request } } }
    writeFileSync(draftFile, JSON.stringify(draft))
    const result = join(dir, `${eventId}.result.json`)
    const invoke = (action: string, data: unknown) => invokeTool(action, JSON.stringify(data), {
      BA_INSTAGRAM_STATE_DIR: state, BA_INVESTIGATION_DIR: dir,
      BA_INVESTIGATION_ENTRY: fileURLToPath(new URL('../../../scripts/instagram-publisher.ts', import.meta.url)),
      BA_INVESTIGATION_NODE: process.execPath,
    })
    const finding = { verdict: 'exclude', reason: 'Synthetic event is out of scope.', hermes: 'a'.repeat(301) }
    expect(invoke('finish', [eventId, finding])).toEqual([{ type: 'text', text: 'hermes: Too big: expected string to have <=300 characters' }])
    expect(existsSync(result)).toBe(false)
    expect(invoke('finish', [eventId, { ...finding, hermes: 'Check the venue listing.' }]))
      .toEqual([{ type: 'text', text: '"Finding saved."' }])
    expect(existsSync(result)).toBe(true)

    const missing = join(dir, 'missing.jpg')
    writeFileSync(join(dir, 'evidence.json'), JSON.stringify({ frames: [missing] }))
    expect(invoke('image', 'cover')).toEqual([{ type: 'text', text: 'The operation could not complete.' }])

    const fix = { id: eventId, field: 'status', from: 'scheduled', to: 'canceled', evidence: 'https://source.example/', allOccurrences: false }
    mkdirSync(join(dir, 'catalog-fix.lock'))
    expect(invoke('catalog-fix', fix)).toEqual([{ type: 'text', text: 'The operation could not complete.' }])

    const receipt = { actor: 'hermes' as const, at: new Date(startsAt).toISOString(), reason: 'Synthetic instruction',
      preview: { revision: 1, channel: 'C_TEST', ts: '1.0', instagram: false, threads: true } }
    writeFileSync(draftFile, JSON.stringify({ ...draft, approvedSeenAt: null, delegatedApprovals: [receipt] }))
    // A Threads-only approval reaches the (held) catalog lock rather than losing ownership of the preview.
    expect(invoke('catalog-fix', fix)).toEqual([{ type: 'text', text: 'The operation could not complete.' }])
    writeFileSync(draftFile, JSON.stringify({ ...draft, approvedSeenAt: receipt.at,
      delegatedApprovals: [{ ...receipt, preview: { ...receipt.preview, instagram: true } }] }))
    const inactive = [{ type: 'text', text: 'The investigation no longer owns this preview.' }]
    expect(invoke('catalog-fix', fix)).toEqual(inactive)
    writeFileSync(draftFile, JSON.stringify(draft))
    recordDelegatedVeto(state, id, receipt)
    expect(invoke('catalog-fix', fix)).toEqual(inactive)
  } finally {
    rmSync(state, { recursive: true, force: true })
  }
})

it.each(['https://127.0.0.1/', 'https://[::1]/', 'https://0127.0.0.1/', 'https://some.host.local/',
  'https://user:password@public.example/', 'https://public.example:8080/', 'http://public.example/'])('refuses nonpublic research URL %s', url => {
  expect(() => publicResearchUrl(url)).toThrow('public HTTPS')
})
