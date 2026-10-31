import { setup, transition, types } from 'xstate'

export type DeliveryPhase = 'running' | 'persisting' | 'completed' | 'failed' | 'cancelled'
type DeliveryFacts = {
  phase: DeliveryPhase
  workflowId?: string
  hasCheckpoint?: boolean
  hasCanonical: boolean
}
type DeliveryEvent = { type: 'CHECKPOINT' | 'COMMIT' | 'CANONICAL' | 'COMPLETE' | 'FAIL' | 'CANCEL' }

/** Pure policy. DO serialization and atomic storage writes remain the durable authority. */
export const durableDeliveryMachine = setup({
  schemas: {
    context: types<{ workflow: boolean; checkpoint: boolean; canonical: boolean }>(),
    events: {
      CHECKPOINT: types<{}>(), COMMIT: types<{}>(), CANONICAL: types<{}>(),
      COMPLETE: types<{}>(), FAIL: types<{}>(), CANCEL: types<{}>(),
    },
  },
}).createMachine({
  id: 'durableDelivery',
  initial: 'running',
  context: { workflow: false, checkpoint: false, canonical: false },
  states: {
    running: { on: {
      CHECKPOINT: ({ context }) => {
        if (!context.checkpoint) return { context: { checkpoint: true } }
      },
      COMMIT: ({ context }) => {
        if (!context.workflow || context.checkpoint) return { target: 'persisting' }
      },
      CANCEL: { target: 'cancelled' }, FAIL: { target: 'failed' },
    } },
    persisting: { on: {
      COMMIT: ({ context }) => {
        if (!context.workflow || context.checkpoint) return { target: 'persisting' }
      },
      CANONICAL: ({ context }) => {
        if (!context.canonical) return { context: { canonical: true } }
      },
      COMPLETE: ({ context }) => {
        if (context.canonical) return { target: 'completed' }
      },
      FAIL: { target: 'failed' },
    } },
    completed: { type: 'final' },
    failed: { type: 'final' },
    cancelled: { type: 'final' },
  },
})

function restore(facts: DeliveryFacts) {
  return durableDeliveryMachine.resolveState({ value: facts.phase, context: {
    workflow: !!facts.workflowId, checkpoint: !!facts.hasCheckpoint, canonical: facts.hasCanonical,
  } })
}

export function canTransitionDelivery(facts: DeliveryFacts, type: DeliveryEvent['type']): boolean {
  return restore(facts).can({ type })
}

/** Updates only the existing fields, inside the caller's serialized storage operation. */
export function transitionDelivery(facts: DeliveryFacts, type: DeliveryEvent['type']): void {
  const current = restore(facts)
  if (!current.can({ type })) throw new Error(`Invalid delivery transition: ${facts.phase}/${type}`)
  const [next] = transition(durableDeliveryMachine, current, { type })
  facts.phase = next.value as DeliveryPhase
  facts.hasCanonical = next.context.canonical
  if (type === 'CHECKPOINT') facts.hasCheckpoint = next.context.checkpoint
}

export function isDeliveryTerminal(facts: DeliveryFacts): boolean {
  return restore(facts).status === 'done'
}
