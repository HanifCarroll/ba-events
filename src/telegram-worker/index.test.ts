import { describe, expect, it } from 'vitest'
import { TelegramApiError } from '#features/telegram/client.ts'
import { TelegramInbox, boundedBackoffMs, type InboxItem } from './index.ts'

function storage() {
  const values = new Map<string, unknown>()
  return {
    values,
    async get<T>(key: string) { return values.get(key) as T | undefined },
    async put(...args: [Record<string, unknown>] | [string, unknown]) {
      if (typeof args[0] === 'string') values.set(args[0], args[1])
      else for (const [key, item] of Object.entries(args[0])) values.set(key, item)
    },
    async setAlarm(at: number) { values.set('alarm', at) },
    async delete(key: string) { values.delete(key) },
    async list<T>({ prefix, limit }: { prefix?: string; limit?: number } = {}) {
      const entries = [...values.entries()]
        .filter(([key]) => !prefix || key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, limit ?? Infinity) as [string, T][]
      return { entries: () => entries[Symbol.iterator](), size: entries.length }
    },
  }
}

const payload = (updateId: string) => ({
  updateId,
  queueKey: '00000000-0000-4000-8000-000000000001',
  sealedEnvelope: `opaque-${updateId}`,
})

async function enqueue(inbox: TelegramInbox, updateId: string) {
  await inbox.fetch(new Request('https://telegram-inbox', {
    method: 'POST',
    body: JSON.stringify(payload(updateId)),
  }))
}

describe('Telegram inbox worker', () => {
  it('uses bounded exponential backoff', () => {
    expect(boundedBackoffMs(0)).toBe(1_000)
    expect(boundedBackoffMs(5)).toBe(30_000)
  })

  it('persists opaque payloads with a plain record and deduplicates by update id', async () => {
    const fakeStorage = storage()
    const inbox = new TelegramInbox({ storage: fakeStorage }, {} as never, viProcessor())
    await enqueue(inbox, '42')
    await enqueue(inbox, '42')
    expect([...fakeStorage.values.keys()].filter((key) => key.startsWith('item:'))).toHaveLength(1)
    expect(fakeStorage.values.get('item:0000000000000000')).toMatchObject({ payload: payload('42'), attempts: 0 })
  })

  it('processes only the ordered head and cleans seen state after success', async () => {
    const fakeStorage = storage()
    const processed: string[] = []
    const inbox = new TelegramInbox({ storage: fakeStorage }, {} as never, async (item) => {
      processed.push(item.updateId)
    })
    await enqueue(inbox, '1')
    await enqueue(inbox, '2')
    await inbox.alarm()
    expect(processed).toEqual(['1'])
    expect(fakeStorage.values.has('seen:1')).toBe(false)
    expect(fakeStorage.values.has('item:0000000000000001')).toBe(true)
    await inbox.alarm()
    expect(processed).toEqual(['1', '2'])
    expect(fakeStorage.values.has('seen:2')).toBe(false)
  })

  it('reschedules ordinary failures with exponential backoff', async () => {
    const fakeStorage = storage()
    const inbox = new TelegramInbox({ storage: fakeStorage }, {} as never, viProcessor(new Error('offline')))
    await enqueue(inbox, '3')
    const before = Date.now()
    await inbox.alarm()
    expect(fakeStorage.values.get('item:0000000000000000')).toMatchObject({ attempts: 1 })
    expect(fakeStorage.values.get('alarm') as number).toBeGreaterThanOrEqual(before + 1_000)
  })

  it('uses the full positive Telegram retry_after for scheduling', async () => {
    const fakeStorage = storage()
    const inbox = new TelegramInbox(
      { storage: fakeStorage },
      {} as never,
      viProcessor(new TelegramApiError('rate limited', 429, 75)),
    )
    await enqueue(inbox, '4')
    const before = Date.now()
    await inbox.alarm()
    expect(fakeStorage.values.get('alarm') as number).toBeGreaterThanOrEqual(before + 75_000)
  })

  it('attempts exactly three times, cleans terminal state, then progresses', async () => {
    const fakeStorage = storage()
    const processed: string[] = []
    const inbox = new TelegramInbox({ storage: fakeStorage }, {} as never, async (item) => {
      processed.push(item.updateId)
      if (item.updateId === '5') throw new Error('permanent')
    })
    await enqueue(inbox, '5')
    await enqueue(inbox, '6')
    await inbox.alarm()
    await inbox.alarm()
    await inbox.alarm()
    expect(processed).toEqual(['5', '5', '5'])
    expect(fakeStorage.values.has('seen:5')).toBe(false)
    expect(fakeStorage.values.has('item:0000000000000000')).toBe(false)
    await inbox.alarm()
    expect(processed).toEqual(['5', '5', '5', '6'])
  })
})

function viProcessor(error?: Error) {
  return async (item: InboxItem) => {
    if (error) throw error
    void item
  }
}
