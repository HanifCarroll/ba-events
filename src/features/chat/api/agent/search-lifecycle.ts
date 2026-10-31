import { initialTransition, setup, transition, types } from 'xstate'
import type { SearchRetryBoundary } from '../tools/search-retry.ts'

/** One search policy per concierge turn; tool execution remains an Effect/SDK leaf. */
export const searchLifecycleMachine = setup({
  schemas: {
    context: types<{ attempt: number; boundary: SearchRetryBoundary | undefined }>(),
    events: {
      START: types<{}>(),
      RESULT: types<{ attempt: number; found: boolean; boundary?: SearchRetryBoundary }>(),
      FAILED: types<{ attempt: number }>(),
    },
  },
}).createMachine({
  id: 'conciergeSearch',
  initial: 'ready',
  context: { attempt: 0, boundary: undefined },
  states: {
    ready: { on: { START: ({ context }) => ({ target: 'searching', context: { attempt: context.attempt + 1 } }) } },
    searching: { on: {
      RESULT: ({ context, event }) => {
        if (event.attempt !== context.attempt) return
        const boundary = context.boundary ?? (event.boundary ? structuredClone(event.boundary) : undefined)
        return event.found
          ? { target: 'succeeded', context: { boundary } }
          : { target: 'ready', context: { boundary } }
      },
      FAILED: ({ context, event }) => {
        if (event.attempt === context.attempt) return { target: 'ready' }
      },
    } },
    succeeded: { type: 'final' },
  },
})

export function createSearchLifecycle() {
  let [snapshot] = initialTransition(searchLifecycleMachine)
  const send = (event: Parameters<typeof searchLifecycleMachine.transition>[1]) => {
    ;[snapshot] = transition(searchLifecycleMachine, snapshot, event)
  }
  return {
    begin(): { error: 'search_already_succeeded' | 'search_in_progress' } |
      { attempt: number; boundary: SearchRetryBoundary | undefined } {
      if (snapshot.matches('succeeded')) return { error: 'search_already_succeeded' } as const
      if (snapshot.matches('searching')) return { error: 'search_in_progress' } as const
      send({ type: 'START' })
      return { attempt: snapshot.context.attempt, boundary: snapshot.context.boundary } as const
    },
    complete(attempt: number, found: boolean, boundary?: SearchRetryBoundary) {
      send({ type: 'RESULT', attempt, found, boundary })
    },
    fail(attempt: number) { send({ type: 'FAILED', attempt }) },
  }
}
