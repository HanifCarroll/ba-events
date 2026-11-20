import { expect, it } from 'vitest'
import { apifyRequest } from '../../../../scripts/instagram-intake.ts'

it('recovers an Actor-only wrapper on a GET, then uses the full CLI for the paid request', async () => {
  const calls: string[][] = []
  const api = apifyRequest('/private/wrapper', async (args, body) => {
    calls.push([...args, ...(body ? [body] : [])])
    if (args[0] === '/private/wrapper') return { ok: false, stderr: 'Warning: old version\nError: Command api not found\n' }
    return { ok: true, stdout: '{"data":{}}' }
  })
  await expect(api('GET', 'users/me/limits')).resolves.toEqual({ data: {} })
  await api('POST', 'actors/synthetic/runs', { timeout: 30 }, { username: ['synthetic'] })
  expect(calls).toEqual([
    ['/private/wrapper', 'api', 'GET', 'users/me/limits'],
    ['bunx', '--package', 'apify-cli@1.10.0', 'apify', 'api', 'GET', 'users/me/limits'],
    ['bunx', '--package', 'apify-cli@1.10.0', 'apify', 'api', 'POST', 'actors/synthetic/runs', '-p', '{"timeout":30}', '-d', '-', '{"username":["synthetic"]}'],
  ])
})

it('does not retry a POST or switch credentials for any other GET failure', async () => {
  for (const [method, stderr] of [['POST', 'Error: Command api not found'], ['GET', 'Error: private provider output']] as const) {
    const calls: string[] = []
    const api = apifyRequest('/private/wrapper', async ([command]) => {
      calls.push(command)
      return { ok: false, stderr }
    })
    await expect(api(method, 'synthetic')).rejects.toThrow(`Apify ${method} request failed; check CLI login`)
    expect(calls).toEqual(['/private/wrapper'])
  }
})
