import { describe, expect, it, vi } from 'vitest'

import { createInstrumentedTools } from './tools.ts'
import type { CreateToolsFn } from './tools.ts'

type ToolObject = { execute: (input: unknown, options?: unknown) => Promise<unknown> }

function baseTools(): Record<string, ToolObject> {
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

function toolsWith(base: CreateToolsFn, extra: Record<string, unknown> = {}) {
  return createInstrumentedTools({
    userContext: { userId: null, isAuthenticated: false },
    locale: 'en',
    createToolsFn: base,
    ...extra,
  }) as Record<string, ToolObject>
}

describe('createInstrumentedTools (v5)', () => {
  it('never exposes save_event or unsave_event in the work loop', () => {
    const tools = toolsWith(() => baseTools())
    expect(tools.save_event).toBeUndefined()
    expect(tools.unsave_event).toBeUndefined()
    expect(tools.search_events).toBeDefined()
    expect(tools.get_event_details).toBeDefined()
    expect(tools.check_event_saved).toBeDefined()
  })

  it('retain_search_results accepts a validated earlier search source', async () => {
    const tools = toolsWith(() => baseTools(), {
      retention: { currentStepIndex: 1, searchStages: [{ stepIndex: 0, toolCallIds: ['s0'] }] },
    })
    const result = (await tools.retain_search_results.execute({ sourceToolCallIds: ['s0'] })) as {
      success: boolean
      retained?: string[]
    }
    expect(result.success).toBe(true)
    expect(result.retained).toEqual(['s0'])
  })

  it('retain_search_results rejects current/future/unknown/non-search ids', async () => {
    const tools = toolsWith(() => baseTools(), {
      retention: {
        currentStepIndex: 1,
        searchStages: [{ stepIndex: 0, toolCallIds: ['s0'] }],
      },
    })
    const result = (await tools.retain_search_results.execute({ sourceToolCallIds: ['s1'] })) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid_retention')
  })

  it('reject_search_results accepts a complete prior search stage', async () => {
    const tools = toolsWith(() => baseTools(), {
      retention: { currentStepIndex: 2, searchStages: [{ stepIndex: 0, toolCallIds: ['s0a', 's0b'] }] },
    })
    const result = (await tools.reject_search_results.execute({ sourceToolCallIds: ['s0a', 's0b'] })) as {
      success: boolean
      rejected?: string[]
    }
    expect(result.success).toBe(true)
    expect(result.rejected).toEqual(['s0a', 's0b'])
  })

  it('reject_search_results rejects partial/current/future/non-search ids', async () => {
    const tools = toolsWith(() => baseTools(), {
      retention: { currentStepIndex: 2, searchStages: [{ stepIndex: 0, toolCallIds: ['s0a', 's0b'] }] },
    })
    const result = (await tools.reject_search_results.execute({ sourceToolCallIds: ['s0a'] })) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid_rejection')
  })

  it('removes broad discovery tools in pinned mode but keeps details/directions/related', () => {
    const tools = toolsWith(() => baseTools(), { pinnedEventId: 'pin' })
    expect(tools.search_events).toBeUndefined()
    expect(tools.list_saved_events).toBeUndefined()
    expect(tools.get_event_details).toBeDefined()
    expect(tools.get_directions).toBeDefined()
    expect(tools.retain_search_results).toBeDefined()
    expect(tools.reject_search_results).toBeDefined()
  })
})
