#!/usr/bin/env bun
/**
 * Concierge eval cases.
 *
 * Each case encodes rules from the concierge system prompt
 * (src/features/chat/api/prompts/concierge.ts): decision rules (1 pick vs
 * short list vs max 5), tool selection, filter arguments, scope refusals.
 * Voice, locale, and grounding checks apply globally in run.ts.
 */
import type { AgentRun } from '../lib/run-agent.ts'

export interface ConciergeExpectation {
  /** at least one of these tools must be called */
  anyToolOf?: string[]
  /** no tool calls allowed (scope refusals) */
  noTools?: boolean
  /** effective limit bounds on primary search/list tool calls */
  limitMin?: number
  limitMax?: number
  /** subset match against the first search_events input */
  searchArgs?: Record<string, unknown>
  /** first search_events call must set maxPrice <= this */
  maxPriceLte?: number
  /** vague asks: passing with a clarifying question instead of tools is OK */
  allowQuestionInstead?: boolean
  /** reply text must not match this */
  forbid?: RegExp
  /** custom assertion; return failure description or null */
  custom?: (run: AgentRun) => string | null
}

export interface ConciergeCase {
  id: string
  message: string
  locale: 'en' | 'es'
  expect: ConciergeExpectation
}

export const CONCIERGE_CASES: ConciergeCase[] = [
  // --- Decision rules: decisive asks -> ONE pick ---
  {
    id: 'decide-surprise-me',
    message: 'Surprise me with something tonight',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], limitMax: 1 },
  },
  {
    id: 'decide-pick-for-me',
    message: 'Just pick something for me this weekend, I trust your taste',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], limitMax: 1 },
  },
  {
    id: 'decide-just-choose',
    message: "I can't decide, you choose for tonight",
    locale: 'en',
    expect: { anyToolOf: ['search_events'], limitMax: 1 },
  },
  {
    id: 'decide-es-sorprendeme',
    message: 'Sorprendeme con algo para hoy a la noche',
    locale: 'es',
    expect: { anyToolOf: ['search_events'], limitMax: 1 },
  },

  // --- Decision rules: discovery asks -> short list (3-4, never >5) ---
  {
    id: 'discover-tonight',
    message: "What's on tonight?",
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMin: 2,
      limitMax: 5,
      searchArgs: { timeFilter: 'tonight' },
    },
  },
  {
    id: 'discover-palermo',
    message: "What's happening in Palermo?",
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMin: 2,
      limitMax: 5,
      searchArgs: { neighborhoods: ['Palermo'] },
    },
  },
  {
    id: 'discover-techno-weekend',
    message: 'Any good techno this weekend?',
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMin: 2,
      limitMax: 5,
      searchArgs: { timeFilter: 'weekend' },
    },
  },
  {
    id: 'discover-es-hoy',
    message: '¿Qué hay para hacer hoy a la noche?',
    locale: 'es',
    expect: { anyToolOf: ['search_events'], limitMax: 5, searchArgs: { timeFilter: 'tonight' } },
  },
  {
    id: 'discover-options-tonight',
    message: 'What are my options tonight?',
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMin: 2,
      limitMax: 5,
      searchArgs: { timeFilter: 'tonight' },
    },
  },

  // --- Explicit counts: up to 5, never more ---
  {
    id: 'count-give-me-5',
    message: 'Give me 5 event options for this week',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], limitMin: 2, limitMax: 5 },
  },
  {
    id: 'count-few-free',
    message: 'Show me a few free events this weekend',
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMax: 5,
      searchArgs: { isFree: true, timeFilter: 'weekend' },
    },
  },

  // --- Filter arguments ---
  {
    id: 'filter-free-palermo-weekend',
    message: 'Free events in Palermo this weekend',
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      searchArgs: { isFree: true, neighborhoods: ['Palermo'], timeFilter: 'weekend' },
    },
  },
  {
    id: 'filter-tango-tomorrow',
    message: 'Tango class tomorrow',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], searchArgs: { timeFilter: 'tomorrow' } },
  },
  {
    id: 'filter-under-10k',
    message: 'Anything good under 10000 pesos tonight?',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], maxPriceLte: 10000 },
  },
  {
    id: 'filter-romantic-week',
    message: 'Romantic date spot sometime this week',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], searchArgs: { timeFilter: 'week' }, limitMax: 5 },
  },
  {
    id: 'filter-es-teatro-finde',
    message: '¿Hay algo de teatro este finde?',
    locale: 'es',
    expect: { anyToolOf: ['search_events'], searchArgs: { timeFilter: 'weekend' } },
  },
  {
    id: 'filter-cultural-weekend',
    message: 'Something cultural to do this weekend',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], searchArgs: { timeFilter: 'weekend' }, limitMax: 5 },
  },
  {
    id: 'filter-wine-weekend',
    message: 'Wine tasting this weekend',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], searchArgs: { timeFilter: 'weekend' } },
  },
  {
    id: 'filter-free-tonight',
    message: 'Anything free tonight?',
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      searchArgs: { isFree: true, timeFilter: 'tonight' },
    },
  },

  // --- Tool selection ---
  {
    id: 'tool-right-now',
    message: "What's happening right now?",
    locale: 'en',
    expect: { anyToolOf: ['search_events'], limitMax: 5, searchArgs: { timeFilter: 'now' } },
  },
  {
    id: 'tool-saved-events',
    message: "What's on my saved list?",
    locale: 'en',
    expect: { anyToolOf: ['list_saved_events'] },
  },

  // --- Vague asks: <=2 questions then search, or just pick ---
  {
    id: 'vague-bored',
    message: "I'm bored",
    locale: 'en',
    // prompt: vague asks -> <=2 questions then search, or just pick something
    expect: {
      anyToolOf: ['search_events'],
      allowQuestionInstead: true,
    },
  },
  {
    id: 'vague-es-no-se',
    message: 'No sé qué hacer hoy',
    locale: 'es',
    expect: {
      anyToolOf: ['search_events'],
      allowQuestionInstead: true,
    },
  },

  // --- Grounding ---
  {
    id: 'ground-jazz',
    message: 'Any jazz tonight?',
    locale: 'en',
    expect: { anyToolOf: ['search_events'], limitMax: 5 },
  },
  {
    // Romantic weekday regression: the model must not settle for a
    // speed-dating/singles card, must emit a non-empty final reply, and every
    // displayed card must be grounded in the validated canonical plan. Text
    // and cards are siblings — prose is NOT required to name the events.
    id: 'ground-romantic-weekday',
    message: "I'm looking for something romantic to do with my girlfriend during the week.",
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMax: 5,
      custom: (run) => {
        if (!run.text.trim()) return 'no final reply'
        const singles = run.events.some((e) =>
          /speed.?dating|singles|cita.?r[aá]pida|solter/i.test(e.name)
        )
        if (singles) return 'selected a singles/speed-dating card'
        if (!run.cardsGrounded) return 'card not grounded in canonical provenance'
        if (run.events.length === 0) return 'no cards for a recommendation request'
        return null
      },
    },
  },
  {
    id: 'ground-absurd-query',
    message: 'Underwater basket weaving championship',
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      custom: (run) => {
        if (run.events.length > 0) return null // loose semantic match happened; grounding check covers it
        if (/https?:\/\//.test(run.text)) return 'fabricated a link with no tool results'
        if (run.text.trim().split(/\s+/).length > 80) return 'rambling reply to empty results'
        return null
      },
    },
  },

  // --- Exhaustiveness: venue/day enumeration -> broad search, never limit-1 ---
  {
    id: 'enum-venue-weekend',
    message: "What's on at Niceto Club this weekend?",
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMin: 3,
      limitMax: 5,
    },
  },
  {
    id: 'enum-venue-es-sabado',
    message: '¿Qué hay en Niceto el sábado?',
    locale: 'es',
    expect: {
      anyToolOf: ['search_events'],
      limitMin: 3,
      limitMax: 5,
    },
  },

  // --- Scope: one-line refusal + redirect, no tools, no answering ---
  {
    id: 'scope-share-guidance',
    message: 'How can I share this event with a friend?',
    locale: 'en',
    expect: {
      noTools: true,
      custom: (run) =>
        /share button/i.test(run.text) ? null : 'did not point to the share button',
    },
  },
  {
    id: 'scope-python',
    message: 'Write a Python function to sort a list',
    locale: 'en',
    expect: { noTools: true, forbid: /```/ },
  },
  {
    id: 'scope-capital-of-france',
    message: "What's the capital of France?",
    locale: 'en',
    expect: { noTools: true, forbid: /paris/i },
  },
  {
    id: 'scope-es-weather',
    message: '¿Va a llover esta noche?',
    locale: 'es',
    expect: { noTools: true },
  },

  // --- Compound discovery + event-relative/mutation actions ---
  // Regression: the turn target must be clause-aware. A discovery-first
  // directions/mutation request resolves against the CURRENT selection, never
  // a prior event; a mutation-first command keeps prior semantics. A
  // single-turn eval has no prior group, so a prior-only command must produce
  // zero side effects (clarify), never a save against nothing.
  {
    id: 'compound-directions-lead',
    message: 'Find me a tango event and give me directions to it.',
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMax: 5,
      custom: (run) => {
        if (run.events.length === 0) return 'no event shown to take directions to'
        const call = run.toolCalls.find((t) => t.toolName === 'get_directions')
        if (!call) return 'get_directions was not called'
        const lead = run.events[0]
        const eventMatches = call.input.eventId === lead.id
        const venueMatches =
          typeof lead.venue_id === 'string' && call.input.venueId === lead.venue_id
        if (!eventMatches && !venueMatches) {
          return 'get_directions targeted neither the lead event nor its venue'
        }
        const d = run.canonical.directions
        if (d && d.eventId !== lead.id && d.venueId !== lead.venue_id) {
          return 'attached directions target neither the lead event nor its venue'
        }
        return null
      },
    },
  },
  {
    id: 'compound-save-second',
    message: 'Find three options and save the second one.',
    locale: 'en',
    expect: {
      anyToolOf: ['search_events'],
      limitMin: 3,
      limitMax: 5,
      custom: (run) => {
        const save = run.canonical.operations.find((o) => o.toolName === 'save_event')
        if (!save) return 'no save executed for the second option'
        if (run.events.length < 2) return 'fewer than two options shown (no second option)'
        if (save.eventId !== run.events[1].id) {
          return `saved ${save.eventId}, expected the second option ${run.events[1].id}`
        }
        return null
      },
    },
  },
  {
    id: 'compound-save-prior-then-find',
    message: 'Save the second one, then find me something else.',
    locale: 'en',
    expect: {
      custom: (run) => {
        // Mutation-first "save the second one" has no prior group in a
        // single-turn eval -> zero side effects (clarify), never a save.
        if (run.canonical.operations.length > 0) {
          return 'executed a mutation with no resolvable prior target'
        }
        if (run.canonical.kind !== 'clarification') {
          return `expected clarification, got ${run.canonical.kind}`
        }
        return null
      },
    },
  },

  // --- Fails-closed mutation parsing: negation/interrogative/conflict never mutate ---
  {
    id: 'mutation-negated-dont-save',
    message: "Don't save it—just show me directions",
    locale: 'en',
    expect: {
      custom: (run) =>
        run.canonical.operations.length > 0 ? 'executed a mutation despite negation' : null,
    },
  },
  {
    id: 'mutation-negated-do-not-save',
    message: 'Do not save this event',
    locale: 'en',
    expect: {
      custom: (run) =>
        run.canonical.operations.length > 0 ? 'executed a mutation despite negation' : null,
    },
  },
  {
    id: 'mutation-interrogative-should-i-save',
    message: 'Should I save it?',
    locale: 'en',
    expect: {
      custom: (run) =>
        run.canonical.operations.length > 0 ? 'executed a mutation for an interrogative' : null,
    },
  },
  {
    id: 'mutation-interrogative-save-or-unsave',
    message: 'Should I save or unsave it?',
    locale: 'en',
    expect: {
      custom: (run) =>
        run.canonical.operations.length > 0 ? 'executed a mutation for an interrogative' : null,
    },
  },
  {
    id: 'mutation-conflict-save-unsave',
    message: 'Save it? No, unsave it.',
    locale: 'en',
    expect: {
      custom: (run) => {
        if (run.canonical.operations.length > 0) return 'executed a mutation for a conflicting command'
        if (run.canonical.kind !== 'clarification') return `expected clarification, got ${run.canonical.kind}`
        return null
      },
    },
  },
  {
    id: 'mutation-negated-es-no-guardes',
    message: 'No guardes este evento, mostrame las direcciones',
    locale: 'es',
    expect: {
      custom: (run) =>
        run.canonical.operations.length > 0 ? 'ejecutó una mutación pese a la negación' : null,
    },
  },
]
