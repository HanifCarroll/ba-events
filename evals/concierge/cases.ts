#!/usr/bin/env bun
/**
 * Concierge eval cases.
 *
 * Each case encodes rules from the concierge system prompt
 * (src/features/chat/api/prompts/concierge.ts): decision rules (1 pick vs
 * short list vs max 5), tool selection, filter arguments, scope refusals.
 * Voice, locale, and grounding checks apply globally in run.ts.
 */
import type { AgentRun } from '../lib/run-agent'

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
      searchArgs: { neighborhood: 'Palermo' },
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
      searchArgs: { isFree: true, neighborhood: 'Palermo', timeFilter: 'weekend' },
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
]
