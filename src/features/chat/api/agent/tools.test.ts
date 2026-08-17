import { describe, expect, it, vi } from 'vitest'

vi.mock('../tools-ai-sdk.ts', () => ({ createTools: vi.fn() }))

import { createInstrumentedTools } from './tools.ts'
import { createTools } from '../tools-ai-sdk.ts'

const mockedCreateTools = vi.mocked(createTools)

function baseTools() {
  return {
    search_events: { execute: vi.fn() },
    list_saved_events: { execute: vi.fn() },
    get_event_details: { execute: vi.fn() },
    get_venue_details: { execute: vi.fn() },
    get_directions: { execute: vi.fn() },
    check_event_saved: { execute: vi.fn() },
    save_event: { execute: vi.fn() },
    unsave_event: { execute: vi.fn() },
  }
}

describe('createInstrumentedTools (v4)', () => {
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

    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      allowMutations: true,
    }) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    const results = await Promise.all([
      tools.save_event.execute({ eventId: 'e1' }),
      tools.save_event.execute({ eventId: 'e1' }),
      tools.save_event.execute({ eventId: 'e1' }),
    ])

    expect(baseCalls).toBe(1)
    expect(saveExecute).toHaveBeenCalledTimes(1)
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

    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      allowMutations: true,
    }) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    await Promise.all([
      tools.save_event.execute({ eventId: 'e1' }),
      tools.save_event.execute({ eventId: 'e1' }),
    ])
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

    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      allowMutations: true,
    }) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    await Promise.all([
      tools.save_event.execute({ eventId: 'e1' }),
      tools.save_event.execute({ eventId: 'e2' }),
    ])

    expect(baseCalls).toBe(2)
  })

  it('retain_search_results accepts a validated earlier search source', async () => {
    mockedCreateTools.mockReturnValue(baseTools() as never)
    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      retention: { currentStepIndex: 1, searchStages: [{ stepIndex: 0, toolCallIds: ['s0'] }] },
    }) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    const result = (await tools.retain_search_results.execute({ sourceToolCallIds: ['s0'] })) as { success: boolean; retained?: string[] }
    expect(result.success).toBe(true)
    expect(result.retained).toEqual(['s0'])
  })

  it('retain_search_results rejects current/future/unknown/non-search ids', async () => {
    mockedCreateTools.mockReturnValue(baseTools() as never)
    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      retention: {
        currentStepIndex: 1,
        searchStages: [{ stepIndex: 0, toolCallIds: ['s0'] }],
      },
    }) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    // s1 (not yet recorded) and s0-in-current-step are both invalid here.
    const result = (await tools.retain_search_results.execute({ sourceToolCallIds: ['s1'] })) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid_retention')
  })

  it('reject_search_results accepts a complete prior search stage', async () => {
    mockedCreateTools.mockReturnValue(baseTools() as never)
    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      retention: { currentStepIndex: 2, searchStages: [{ stepIndex: 0, toolCallIds: ['s0a', 's0b'] }] },
    }) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    const result = (await tools.reject_search_results.execute({ sourceToolCallIds: ['s0a', 's0b'] })) as { success: boolean; rejected?: string[] }
    expect(result.success).toBe(true)
    expect(result.rejected).toEqual(['s0a', 's0b'])
  })

  it('reject_search_results rejects partial/current/future/non-search ids', async () => {
    mockedCreateTools.mockReturnValue(baseTools() as never)
    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      retention: { currentStepIndex: 2, searchStages: [{ stepIndex: 0, toolCallIds: ['s0a', 's0b'] }] },
    }) as Record<string, { execute: (input: unknown, options?: unknown) => Promise<unknown> }>

    // Partial stage (only one of two ids) must be rejected.
    const result = (await tools.reject_search_results.execute({ sourceToolCallIds: ['s0a'] })) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid_rejection')
  })

  it('removes broad discovery tools in pinned mode but keeps details/directions/related', () => {
    mockedCreateTools.mockReturnValue(baseTools() as never)
    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      pinnedEventId: 'pin',
    }) as Record<string, unknown>

    expect(tools.search_events).toBeUndefined()
    expect(tools.list_saved_events).toBeUndefined()
    expect(tools.get_event_details).toBeDefined()
    expect(tools.get_directions).toBeDefined()
    expect(tools.retain_search_results).toBeDefined()
    expect(tools.reject_search_results).toBeDefined()
  })

  it('removes save_event/unsave_event when allowMutations is false (structural gating)', () => {
    mockedCreateTools.mockReturnValue(baseTools() as never)
    const tools = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      allowMutations: false,
    }) as Record<string, unknown>

    expect(tools.save_event).toBeUndefined()
    expect(tools.unsave_event).toBeUndefined()
    expect(tools.search_events).toBeDefined()
    expect(tools.get_event_details).toBeDefined()
  })

  it('keeps mutation tools only when explicitly allowed and defaults closed', () => {
    mockedCreateTools.mockReturnValue(baseTools() as never)
    const gated = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
      allowMutations: true,
    }) as Record<string, unknown>
    expect(gated.save_event).toBeDefined()
    expect(gated.unsave_event).toBeDefined()

    mockedCreateTools.mockReturnValue(baseTools() as never)
    const defaulted = createInstrumentedTools({
      userContext: { userId: null, isAuthenticated: false },
      locale: 'en',
    }) as Record<string, unknown>
    expect(defaulted.save_event).toBeUndefined()
    expect(defaulted.unsave_event).toBeUndefined()
  })
})
