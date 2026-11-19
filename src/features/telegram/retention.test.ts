import { expect, it } from 'vitest'
import { purgeTelegramRetention } from './retention.ts'

it('fails instead of silently skipping a D1 purge error', async () => {
  const prepare = () => { throw new Error('offline') }
  await expect(purgeTelegramRetention({ prepare } as never)).rejects.toThrow('Telegram retention failed')
})
