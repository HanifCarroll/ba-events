import { describe, expect, it } from 'vitest'
import { PLANNER_SYSTEM, turnPlanSchema, buildPlannerPrompt, type TurnPlan } from './planner.ts'

function validSearch(): Record<string, unknown> {
  return { kind: 'search', search: { query: 'jazz' }, count: 3, followUp: null }
}

describe('turnPlanSchema (closed plan)', () => {
  it('parses every plan kind', () => {
    const plans: Array<Record<string, unknown>> = [
      validSearch(),
      {
        kind: 'search',
        search: { timeFilter: 'tonight' },
        count: 5,
        followUp: { action: 'directions', resultIndex: 1 },
      },
      {
        kind: 'prior_event_action',
        action: 'show_for_save',
        targetHandle: 'req-1:event_1',
      },
      { kind: 'pinned_event_action', action: 'event_details' },
      { kind: 'list_saved', filter: 'upcoming' },
      { kind: 'clarification', question: 'which_day' },
      { kind: 'out_of_scope' },
    ]
    for (const p of plans) {
      expect(turnPlanSchema.safeParse(p).success).toBe(true)
    }
  })

  it('rejects invalid plans (fail closed)', () => {
    const invalid: Array<Record<string, unknown>> = [
      { kind: 'nope' },
      { kind: 'search', search: {}, count: 9, followUp: null }, // count out of range
      { kind: 'search', search: {}, count: 3, followUp: { action: 'save', resultIndex: 0 } }, // bad action
      { kind: 'search', search: {}, count: 3, followUp: { action: 'directions', resultIndex: 9 } }, // index out of range
      { kind: 'prior_event_action', action: 'directions' }, // missing targetHandle
      { kind: 'prior_event_action', action: 'directions', targetHandle: '' }, // empty handle
      { kind: 'pinned_event_action', action: 'explode' }, // bad action
      { kind: 'pinned_event_action', action: ['event_details', 'directions'] }, // compounds cannot chain
      { kind: 'list_saved', filter: 'soon' }, // bad filter
      { kind: 'clarification', question: 'whatever' }, // bad question key
      { kind: 'clarification' }, // missing question
    ]
    for (const p of invalid) {
      expect(turnPlanSchema.safeParse(p).success).toBe(false)
    }
  })

  it('rejects unknown fields, including model-written prose or event ids', () => {
    const searchPlan = turnPlanSchema.parse(validSearch()) as TurnPlan
    expect('text' in searchPlan).toBe(false)
    expect(turnPlanSchema.safeParse({ kind: 'out_of_scope', text: 'free prose' }).success).toBe(false)
    expect(
      turnPlanSchema.safeParse({
        kind: 'prior_event_action',
        action: 'event_details',
        targetHandle: 'req-1:event_0',
        eventId: '00000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(false)
  })
})

describe('buildPlannerPrompt (bounded server state)', () => {
  it('includes exact handles + facts + saved membership, never a raw UUID', () => {
    const prompt = buildPlannerPrompt({
      originalQuery: 'directions to the second one',
      locale: 'en',
      prior: [
        {
          handle: 'req-1:event_0',
          responseOrder: 0,
          displayOrder: 0,
          name: 'Tango Night',
          venueName: 'Niceto Club',
          saved: true,
        },
        {
          handle: 'req-1:event_1',
          responseOrder: 0,
          displayOrder: 1,
          name: 'Jazz Set',
          venueName: 'La Boheme',
          saved: false,
        },
      ],
    })
    expect(prompt).toContain('req-1:event_0')
    expect(prompt).toContain('req-1:event_1')
    expect(prompt).toContain('Tango Night')
    expect(prompt).toContain('saved')
    expect(prompt).toContain('not-saved')
    expect(prompt).toContain('displayOrder=1')
    expect(prompt).toContain('directions to the second one')
    // The rehydrated fact names are present, but no event UUID is ever emitted.
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
  })

  it('includes first-turn named details and couple avoid rules', () => {
    expect(PLANNER_SYSTEM).toContain('Prior displayed events is none and Pinned event is none')
    expect(PLANNER_SYSTEM).toContain('tell me about X')
    expect(PLANNER_SYSTEM).toContain('which_event')
    expect(PLANNER_SYSTEM).toContain('speed dating')
    expect(PLANNER_SYSTEM).toContain('tinder')
  })

  it('reports the pinned event when one is showing', () => {
    const prompt = buildPlannerPrompt({
      originalQuery: 'give me details',
      locale: 'es',
      prior: [],
      pinned: { name: 'Milonga', venueName: 'La Catedral' },
    })
    expect(prompt).toContain('Milonga')
    expect(prompt).toContain('La Catedral')
  })
})
