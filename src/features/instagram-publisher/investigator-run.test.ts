import { expect, it, vi } from 'vitest'
import { endTime, type InvestigationRequest } from './investigation.ts'
import { startInvestigator } from './investigator-run.ts'
import { publicResearchUrl } from './investigator-web.ts'

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

it.each(['https://127.0.0.1/', 'https://[::1]/', 'https://0127.0.0.1/', 'https://some.host.local/',
  'https://user:password@public.example/', 'https://public.example:8080/', 'http://public.example/'])('refuses nonpublic research URL %s', url => {
  expect(() => publicResearchUrl(url)).toThrow('public HTTPS')
})
