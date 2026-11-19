import { expect, it } from 'vitest'
import { runTunnelHelper } from './story-cdp.ts'

it('returns when the helper exits even if its SSH-like child keeps its streams open', async () => {
  await expect(runTunnelHelper(['/bin/sh', '-c', 'sleep 5 &'], 1_500)).resolves.toBeUndefined()
})

it('fails before Share when the tunnel helper hangs', async () => {
  await expect(runTunnelHelper(['/bin/sh', '-c', 'exec sleep 5'], 50)).rejects.toThrow('tunnel timed out')
})
