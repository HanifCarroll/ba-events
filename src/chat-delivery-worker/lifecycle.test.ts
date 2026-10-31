import { describe, expect, it } from 'vitest'
import { canTransitionDelivery, isDeliveryTerminal, transitionDelivery, type DeliveryPhase } from './lifecycle.ts'

describe('durable delivery transitions from stored facts', () => {
  it('requires checkpoint, commit gate and canonical publication in order', () => {
    const facts = { phase: 'running' as DeliveryPhase, workflowId: 'workflow', hasCheckpoint: false, hasCanonical: false }
    expect(canTransitionDelivery(facts, 'COMMIT')).toBe(false)
    expect(() => transitionDelivery(facts, 'COMPLETE')).toThrow()
    transitionDelivery(facts, 'CHECKPOINT')
    expect(canTransitionDelivery(facts, 'CHECKPOINT')).toBe(false)
    transitionDelivery(facts, 'COMMIT')
    // Repeated commit admission is safe during workflow recovery.
    transitionDelivery(facts, 'COMMIT')
    expect(canTransitionDelivery(facts, 'CANCEL')).toBe(false)
    transitionDelivery(facts, 'CANONICAL')
    expect(canTransitionDelivery(facts, 'CANONICAL')).toBe(false)
    transitionDelivery(facts, 'COMPLETE')
    expect(isDeliveryTerminal(facts)).toBe(true)
    expect(canTransitionDelivery(facts, 'FAIL')).toBe(false)
  })

  it('keeps cancellation terminal and supports the pre-workflow commit contract', () => {
    const cancelled = { phase: 'running' as DeliveryPhase, hasCanonical: false }
    transitionDelivery(cancelled, 'CANCEL')
    expect(canTransitionDelivery(cancelled, 'FAIL')).toBe(false)
    expect(canTransitionDelivery(cancelled, 'COMMIT')).toBe(false)
    const legacy = { phase: 'running' as DeliveryPhase, hasCanonical: false }
    transitionDelivery(legacy, 'COMMIT')
    transitionDelivery(legacy, 'FAIL')
    expect(legacy.phase).toBe('failed')
  })
})
