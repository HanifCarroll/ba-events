import { describe, expect, it, vi } from 'vitest'

vi.mock('../tools-ai-sdk.ts', () => ({ createTools: vi.fn() }))

import { createInstrumentedTools } from './tools.ts'
import { createTools } from '../tools-ai-sdk.ts'

const mockedCreateTools = vi.mocked(createTools)

describe('createInstrumentedTools', () => {
  it('dedupes identical concurrent save calls into one base execution', async () => {
    let baseCalls = 0
    const saveExecute = vi.fn(async () => {
      baseCalls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { success: true, eventId: 'e1' }
    })
    mockedCreateTools.mockReturnValue({
      save_event: { execute: saveExecute },
      unsave_event: { execute: vi.fn() },
    } as never)

    const tools = createInstrumentedTools(
      { userId: null, isAuthenticated: false },
      'en'
    ) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    const results = await Promise.all([
      tools.save_event.execute({ eventId: 'e1' }),
      tools.save_event.execute({ eventId: 'e1' }),
      tools.save_event.execute({ eventId: 'e1' }),
    ])

    expect(baseCalls).toBe(1)
    expect(saveExecute).toHaveBeenCalledTimes(1)
    // Every duplicate resolves to the same base result.
    expect(results[0]).toBe(results[1])
    expect(results[1]).toBe(results[2])
  })

  it('shares one in-flight promise across parallel and later duplicate calls', async () => {
    let baseCalls = 0
    const saveExecute = vi.fn(async () => {
      baseCalls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { success: true }
    })
    mockedCreateTools.mockReturnValue({
      save_event: { execute: saveExecute },
      unsave_event: { execute: vi.fn() },
    } as never)

    const tools = createInstrumentedTools(
      { userId: null, isAuthenticated: false },
      'en'
    ) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    await Promise.all([
      tools.save_event.execute({ eventId: 'e1' }),
      tools.save_event.execute({ eventId: 'e1' }),
    ])
    // A later (sequential) duplicate still hits the memo.
    await tools.save_event.execute({ eventId: 'e1' })

    expect(baseCalls).toBe(1)
  })

  it('keeps distinct event ids separate', async () => {
    let baseCalls = 0
    const saveExecute = vi.fn(async (input: unknown) => {
      baseCalls++
      return { success: true, eventId: (input as { eventId: string }).eventId }
    })
    mockedCreateTools.mockReturnValue({
      save_event: { execute: saveExecute },
      unsave_event: { execute: vi.fn() },
    } as never)

    const tools = createInstrumentedTools(
      { userId: null, isAuthenticated: false },
      'en'
    ) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    await Promise.all([
      tools.save_event.execute({ eventId: 'e1' }),
      tools.save_event.execute({ eventId: 'e2' }),
    ])

    expect(baseCalls).toBe(2)
  })
})
