import { initialTransition, setup, transition, types } from 'xstate'

type InboxProgress = { attempts: number; phase?: 'pending' | 'acknowledging' }

/** Processing retries and acknowledgement retries have different side effects. */
export const inboxLifecycleMachine = setup({
  schemas: {
    input: types<InboxProgress>(),
    context: types<InboxProgress>(),
    events: { PROCESSED: types<{}>(), FAILED: types<{}>(), ACKNOWLEDGED: types<{}>() },
  },
}).createMachine({
  id: 'telegramInbox',
  initial: 'restoring',
  context: ({ input }) => input,
  states: {
    restoring: { always: ({ context }) => context.phase === 'acknowledging'
      ? { target: 'acknowledging' } : { target: 'processing' } },
    processing: { on: {
      PROCESSED: { target: 'acknowledging', context: { phase: 'acknowledging' } },
      FAILED: ({ context }) => context.attempts >= 2
        ? { target: 'exhausted' }
        : { target: 'retry_wait', context: { attempts: context.attempts + 1 } },
    } },
    acknowledging: { on: { ACKNOWLEDGED: { target: 'completed' } } },
    retry_wait: {},
    completed: { type: 'final' },
    exhausted: { type: 'final' },
  },
})

export function createInboxLifecycle(input: InboxProgress) {
  let [snapshot] = initialTransition(inboxLifecycleMachine, input)
  return {
    getSnapshot: () => snapshot,
    send(type: 'PROCESSED' | 'FAILED' | 'ACKNOWLEDGED') {
      ;[snapshot] = transition(inboxLifecycleMachine, snapshot, { type })
      return snapshot
    },
  }
}
