import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { CanonicalChatResponse, Message } from '#shared/lib/types.ts'
import {
  attachSearchContext,
  currentDateInBuenosAires,
  lastSearchContextFromMessages,
  lastSearchContextFromUIMessages,
  searchContextFromCanonical,
} from './search-context.ts'

function canonical(): CanonicalChatResponse {
  return {
    contractVersion: 5,
    requestId: 'req',
    kind: 'recommendations',
    messageKey: 'recommendations',
    text: 'Here are the best matches I found.',
    events: [],
    directions: null,
    venue: null,
    operations: [],
    suggestions: [],
    clarificationQuestions: [],
    provenance: {
      sourceToolCallIds: [],
      directionToolCallIds: [],
      venueToolCallIds: [],
      mutationToolCallIds: [],
      suggestionToolCallIds: [],
      emptySourceToolCallIds: [],
      retainedSourceToolCallIds: [],
      stageIds: [],
      searchAttemptToolCallIds: [],
      searchIncomplete: false,
      origin: 'validated',
      fallbackUsed: false,
      fallbackReason: null,
    },
  }
}

describe('bounded previous-search context', () => {
  it('attaches and validates the exact executed search input', () => {
    const response = canonical()
    attachSearchContext(response, {
      originalQuery: 'jazz in Palermo tonight',
      input: {
        query: 'jazz',
        neighborhoods: ['Palermo'],
        timeFilter: 'tonight',
        limit: 3,
      },
    })

    expect(searchContextFromCanonical(response)).toEqual({
      originalQuery: 'jazz in Palermo tonight',
      input: {
        query: 'jazz',
        neighborhoods: ['Palermo'],
        timeFilter: 'tonight',
        limit: 3,
      },
    })
  })

  it('selects the newest valid guest data-response context', () => {
    const oldResponse = canonical()
    attachSearchContext(oldResponse, {
      originalQuery: 'jazz',
      input: { query: 'jazz', limit: 3 },
    })
    const newResponse = canonical()
    attachSearchContext(newResponse, {
      originalQuery: 'tango tomorrow',
      input: { query: 'tango', timeFilter: 'tomorrow', limit: 4 },
    })

    const messages = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'data-response', data: oldResponse }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'data-response', data: newResponse }] },
    ] as unknown as UIMessage[]

    expect(lastSearchContextFromUIMessages(messages)?.originalQuery).toBe('tango tomorrow')
  })

  it('selects context from server-persisted authenticated messages', () => {
    const response = canonical()
    attachSearchContext(response, {
      originalQuery: 'free art this weekend',
      input: { query: 'art', isFree: true, timeFilter: 'weekend', limit: 3 },
    })
    const messages = [
      {
        role: 'assistant',
        attached_data: { canonical: response },
      },
    ] as unknown as Message[]

    expect(lastSearchContextFromMessages(messages)?.input).toMatchObject({
      query: 'art',
      isFree: true,
      timeFilter: 'weekend',
    })
  })

  it('calculates the date in Buenos Aires rather than UTC', () => {
    expect(currentDateInBuenosAires(new Date('2026-08-18T01:30:00.000Z'))).toBe('2026-08-17')
  })
})
