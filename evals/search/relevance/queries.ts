#!/usr/bin/env bun
/**
 * Seed relevance queries for the offline search eval (Phase 7b).
 *
 * Exactly 22 queries, labeled against the committed corpus fixture ids in
 * evals/search/corpus/events.json. Labels are honest grades:
 *   0 = irrelevant, 1 = marginal, 2 = good, 3 = exact match.
 * "Relevant" for scoring = grade 2 or 3.
 *
 * Coverage, mirroring the failure classes in the plan:
 *   - hard constraints: free, Saturday, Palermo, Niceto venue, tonight, age
 *   - Argentine slang: "finde", "tranqui", "a la gorra"
 *   - misspelling / missing accent ("sabado" for "sábado")
 *   - negation: "anything but techno", "algo que no sea reggaetón"
 *   - composition: "lively but can talk", "romántico pero no caro"
 *   - impossible / no-match (expectEmpty)
 *   - vague: "pick somewhere good", "sorpresa"
 *
 * NOTE: every seed passes `venueIds` (never `venueName`) so canonicalize does
 * not hit the DB venue lookup — the runner stays fully offline.
 *
 * Pinned eval "now" (Buenos Aires time): Thu 2026-08-13 12:00. Weekday/weekend
 * anchors used by relevance queries:
 *   tonight   = Thu Aug 13 18:00 -> Fri 06:00
 *   tomorrow  = Fri Aug 14
 *   weekend   = Sat Aug 15 -> Mon Aug 17 00:00
 *   Saturday  = Sat Aug 15
 *
 * WHY the "midnight–6am" tonight branch is NOT pinned here: the runner feeds
 * one global fixed `RELEVANCE_NOW_BA` (Thu 12:00) to every seed, and the whole
 * fixture + all 22 windows derive from that single anchor. Re-pinning now after
 * 00:30 BA (e.g. Saturday 00:45) would shift tonight/tomorrow/weekend/>tomorrow
 * anchors and break the calendar alignment for every other query; the runner
 * has no per-query `now` hook. The past-midnight retrieval case is still
exercised by `tonight-late` (its target "after hours" event starts Fri 01:00 BA,
 * inside Thu 18:00->Fri 06:00 today-window) — only the now's-own-hour<6 branch
 * of `tonightWindow` is untested. Can be pinned once the runner supports a
 * per-seed `now`.
 */

import { addDays, getDay, setHours, startOfDay } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import type { SearchEventsInput } from '#features/chat/api/tools/search-events.ts'

/** Pinned eval "now" in Buenos Aires wall clock. Thu 2026-08-13 12:00. */
export const RELEVANCE_NOW_BA = new Date(2026, 7, 13, 12, 0, 0)

/** BA wall-clock Date → UTC ISO string (same conversion as search-intent). */
function baToUTCISO(baDate: Date): string {
  return fromZonedTime(baDate, BA_TIMEZONE).toISOString()
}

function tonightWindowBA(now: Date): { after: Date; before: Date } {
  if (now.getHours() < 6) {
    return { after: now, before: setHours(startOfDay(now), 6) }
  }
  const after = setHours(startOfDay(now), 18)
  const before = setHours(startOfDay(addDays(now, 1)), 6)
  return { after, before }
}

function weekendWindowBA(now: Date): { after: Date; before: Date } {
  const dayOfWeek = getDay(now)
  if (dayOfWeek === 6 || dayOfWeek === 0) {
    const monday = startOfDay(addDays(now, dayOfWeek === 6 ? 2 : 1))
    return { after: now, before: monday }
  }
  const daysUntilSaturday = 6 - dayOfWeek
  const saturday = startOfDay(addDays(now, daysUntilSaturday))
  const monday = startOfDay(addDays(saturday, 2))
  return { after: saturday, before: monday }
}

/** A required date-time window (`within`) as UTC ISO bounds. */
export interface DateWindow {
  after: string
  before: string
}

export const WINDOW_TONIGHT: DateWindow = (() => {
  const w = tonightWindowBA(RELEVANCE_NOW_BA)
  return { after: baToUTCISO(w.after), before: baToUTCISO(w.before) }
})()

export const WINDOW_WEEKEND: DateWindow = (() => {
  const w = weekendWindowBA(RELEVANCE_NOW_BA)
  return { after: baToUTCISO(w.after), before: baToUTCISO(w.before) }
})()

export const WINDOW_TOMORROW: DateWindow = (() => {
  const tomorrow = startOfDay(addDays(RELEVANCE_NOW_BA, 1))
  return {
    after: baToUTCISO(tomorrow),
    before: baToUTCISO(startOfDay(addDays(tomorrow, 1))),
  }
})()

/**
 * Single-day window for the dateFrom/dateTo pair in `free-jazz-tomorrow-pilar`:
 * dateFrom = 2026-08-14 and dateTo = 2026-08-15 (the following day). The tool
 * treats each bare date as that calendar day's BA midnight, so the range spans
 * 2026-08-14 00:00 BA → 2026-08-15 00:00 BA. Matches the canonicalized
 * startsAfter/startsBefore exactly.
 */
export const WINDOW_DAY_0814: DateWindow = (() => {
  const from = startOfDay(new Date(2026, 7, 14))
  const to = startOfDay(new Date(2026, 7, 15))
  return { after: baToUTCISO(from), before: baToUTCISO(to) }
})()

/** Tool input for a seed. Structurally a partial of SearchEventsInput. */
export type SeedToolInput = Partial<SearchEventsInput>

export interface SeedMust {
  isFree?: boolean
  weekday?: number // 0=Sun..6=Sat (Buenos Aires)
  neighborhood?: string
  venueId?: string
  minAge?: number
  /** Declared price cap (ARS). Used for both intent fidelity and violations. */
  maxPrice?: number
  /** Required date-time window (UTC ISO) the event must start within. */
  within?: DateWindow
}

export interface SeedQuery {
  id: string
  query: string
  toolInput?: SeedToolInput
  labels: Record<string, 0 | 1 | 2 | 3>
  must?: SeedMust
  expectEmpty?: boolean
}

const NICETO_ID = '11111111-1111-4000-8000-000000000001'

export const RELEVANCE_QUERIES: SeedQuery[] = [
  // ------------------------------------------------------------------
  // HARD CONSTRAINTS
  // ------------------------------------------------------------------
  {
    id: 'free-weekend',
    query: 'eventos gratis para el fin de semana',
    toolInput: { isFree: true, timeFilter: 'weekend' },
    must: { isFree: true, within: WINDOW_WEEKEND },
    labels: {
      '00000000-0000-4000-8000-000000000003': 2, // yoga free (Sat)
      '00000000-0000-4000-8000-000000000005': 2, // free milonga (Sun)
      '00000000-0000-4000-8000-000000000008': 3, // free rooftop festival (Sat)
      '00000000-0000-4000-8000-000000000009': 2, // free design fair (Sun)
      '00000000-0000-4000-8000-000000000010': 2, // free street tango (Sat)
      '00000000-0000-4000-8000-000000000011': 2, // free surprise (Sat)
      '00000000-0000-4000-8000-000000000015': 2, // free trivia (Sun)
      '00000000-0000-4000-8000-000000000016': 3, // free acústico a la gorra (Sat)
      '00000000-0000-4000-8000-000000000019': 2, // free art show (Sun)
      '00000000-0000-4000-8000-000000000020': 2, // free family day (Sun)
      '00000000-0000-4000-8000-000000000023': 0, // café nocturno is Thursday
    },
  },
  {
    id: 'free-saturday',
    query: 'planes gratis para el sábado',
    toolInput: { isFree: true, dateFrom: '2026-08-15', dateTo: '2026-08-16' },
    must: { isFree: true, weekday: 6 },
    labels: {
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000008': 3,
      '00000000-0000-4000-8000-000000000010': 2,
      '00000000-0000-4000-8000-000000000011': 2,
      '00000000-0000-4000-8000-000000000016': 3,
      '00000000-0000-4000-8000-000000000005': 0, // Sunday
      '00000000-0000-4000-8000-000000000023': 0, // Thursday
    },
  },
  {
    id: 'palermo',
    query: 'planes en Palermo',
    toolInput: { neighborhoods: ['Palermo'] },
    must: { neighborhood: 'Palermo' },
    labels: {
      '00000000-0000-4000-8000-000000000001': 2,
      '00000000-0000-4000-8000-000000000002': 2,
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000006': 2,
      '00000000-0000-4000-8000-000000000008': 2,
      '00000000-0000-4000-8000-000000000009': 2,
      '00000000-0000-4000-8000-000000000011': 2,
      '00000000-0000-4000-8000-000000000015': 2,
      '00000000-0000-4000-8000-000000000016': 2,
      '00000000-0000-4000-8000-000000000019': 2,
      '00000000-0000-4000-8000-000000000023': 2, // café Palermo (Thursday but Palermo)
      '00000000-0000-4000-8000-000000000025': 2, // cumbia Niceto (Friday)
      '00000000-0000-4000-8000-000000000005': 0, // San Telmo
    },
  },
  {
    id: 'niceto-venue',
    query: 'eventos en Niceto',
    toolInput: { venueIds: [NICETO_ID] },
    must: { venueId: NICETO_ID },
    labels: {
      '00000000-0000-4000-8000-000000000001': 3,
      '00000000-0000-4000-8000-000000000002': 2,
      '00000000-0000-4000-8000-000000000016': 2,
      '00000000-0000-4000-8000-000000000025': 2,
      '00000000-0000-4000-8000-000000000006': 0, // warehouse, not Niceto
    },
  },
  {
    id: 'tonight',
    query: '¿qué hay esta noche?',
    toolInput: { timeFilter: 'tonight' },
    must: { within: WINDOW_TONIGHT },
    labels: {
      '00000000-0000-4000-8000-000000000023': 3, // café nocturno Thu evening
      '00000000-0000-4000-8000-000000000024': 0, // Friday morning run
    },
  },
  {
    id: 'tonight-late',
    query: '¿qué hay pasada la medianoche hoy?',
    toolInput: { timeFilter: 'tonight' },
    must: { within: WINDOW_TONIGHT },
    labels: {
      '00000000-0000-4000-8000-000000000027': 3, // after hours Fri 01:00 BA
      '00000000-0000-4000-8000-000000000023': 2, // café nocturno still tonight
      '00000000-0000-4000-8000-000000000018': 2, // karting still tonight
      '00000000-0000-4000-8000-000000000024': 0, // Friday morning run (not tonight)
    },
  },
  {
    id: 'age-17',
    query: 'un buen plan donde pueda entrar siendo menor de 18',
    toolInput: { minAge: 17 },
    must: { minAge: 17 },
    labels: {
      '00000000-0000-4000-8000-000000000004': 2, // romantic dinner, all ages
      '00000000-0000-4000-8000-000000000005': 2, // milonga all ages
      '00000000-0000-4000-8000-000000000012': 2, // jazz
      '00000000-0000-4000-8000-000000000013': 2, // chill bar
      '00000000-0000-4000-8000-000000000001': 0, // Niceto techno 18+ -> excluded
      '00000000-0000-4000-8000-000000000006': 0, // warehouse techno 18+ -> excluded
    },
  },

  // ------------------------------------------------------------------
  // ARGENTINE SLANG
  // ------------------------------------------------------------------
  {
    id: 'slang-finde',
    query: 'algo para el finde en Palermo',
    toolInput: { neighborhoods: ['Palermo'], timeFilter: 'weekend' },
    must: { neighborhood: 'Palermo', within: WINDOW_WEEKEND },
    labels: {
      '00000000-0000-4000-8000-000000000001': 2,
      '00000000-0000-4000-8000-000000000002': 2,
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000006': 2,
      '00000000-0000-4000-8000-000000000008': 3,
      '00000000-0000-4000-8000-000000000009': 2,
      '00000000-0000-4000-8000-000000000011': 2,
      '00000000-0000-4000-8000-000000000015': 2,
      '00000000-0000-4000-8000-000000000016': 3,
      '00000000-0000-4000-8000-000000000019': 2,
      '00000000-0000-4000-8000-000000000023': 0, // Thursday
      '00000000-0000-4000-8000-000000000025': 0, // Friday
    },
  },
  {
    id: 'slang-tranqui',
    query: 'un lugar tranqui el fin de semana',
    toolInput: { timeFilter: 'weekend' },
    labels: {
      '00000000-0000-4000-8000-000000000002': 2, // relaxed indie session
      '00000000-0000-4000-8000-000000000003': 3, // chill yoga
      '00000000-0000-4000-8000-000000000013': 3, // bar tranqui
      '00000000-0000-4000-8000-000000000009': 2,
      '00000000-0000-4000-8000-000000000012': 2, // intimate jazz
      '00000000-0000-4000-8000-000000000015': 2,
      '00000000-0000-4000-8000-000000000001': 0, // techno (loud)
      '00000000-0000-4000-8000-000000000006': 0, // techno (loud)
    },
  },
  {
    id: 'slang-gorra',
    query: '¿hay algún show a la gorra?',
    toolInput: { isFree: true },
    must: { isFree: true },
    labels: {
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000005': 2, // free milonga performance
      '00000000-0000-4000-8000-000000000008': 2, // free festival
      '00000000-0000-4000-8000-000000000010': 2, // free street tango
      '00000000-0000-4000-8000-000000000011': 2, // free surprise
      '00000000-0000-4000-8000-000000000016': 3, // acústico a la gorra
      '00000000-0000-4000-8000-000000000023': 1,
      '00000000-0000-4000-8000-000000000009': 1,
      '00000000-0000-4000-8000-000000000019': 1,
      '00000000-0000-4000-8000-000000000020': 1,
      '00000000-0000-4000-8000-000000000015': 1,
    },
  },

  // ------------------------------------------------------------------
  // MISSPELLING / MISSING ACCENT
  // ------------------------------------------------------------------
  {
    id: 'missing-accent-sabado',
    query: 'planes para el sabado en san telmo',
    toolInput: { neighborhoods: ['San Telmo'] },
    must: { neighborhood: 'San Telmo', weekday: 6 },
    labels: {
      '00000000-0000-4000-8000-000000000004': 3, // jazz dinner (Sat)
      '00000000-0000-4000-8000-000000000010': 3, // street tango (Sat)
      '00000000-0000-4000-8000-000000000017': 2, // punk (Sat)
      '00000000-0000-4000-8000-000000000005': 0, // Sunday milonga
      '00000000-0000-4000-8000-000000000012': 0, // Sunday jazz
    },
  },
  {
    id: 'typo-palermo',
    query: 'planes en paleermo',
    // A genuine typo (extra letter in "Palermo"): the neighborhood must come from
    // free text, so intent fidelity exercises spelling robustness.
    must: { neighborhood: 'Palermo' },
    labels: {
      '00000000-0000-4000-8000-000000000001': 2,
      '00000000-0000-4000-8000-000000000002': 2,
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000008': 2,
      '00000000-0000-4000-8000-000000000016': 2,
      '00000000-0000-4000-8000-000000000005': 0, // San Telmo
    },
  },

  // ------------------------------------------------------------------
  // NEGATION
  // ------------------------------------------------------------------
  {
    id: 'anything-but-techno',
    query: 'anything but techno',
    toolInput: { avoid: ['techno'] },
    labels: {
      '00000000-0000-4000-8000-000000000002': 2,
      '00000000-0000-4000-8000-000000000005': 2,
      '00000000-0000-4000-8000-000000000012': 2,
      '00000000-0000-4000-8000-000000000013': 3,
      '00000000-0000-4000-8000-000000000017': 2, // punk
      '00000000-0000-4000-8000-000000000001': 0, // techno -> excluded
      '00000000-0000-4000-8000-000000000006': 0, // techno -> excluded
    },
  },
  {
    id: 'not-reggaeton-weekend',
    query: 'algo que no sea reggaetón este finde',
    toolInput: { avoid: ['reggaeton'], timeFilter: 'weekend' },
    labels: {
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000005': 2,
      '00000000-0000-4000-8000-000000000008': 2,
      '00000000-0000-4000-8000-000000000012': 2,
      '00000000-0000-4000-8000-000000000013': 3,
      '00000000-0000-4000-8000-000000000007': 0, // reggaeton -> excluded
      '00000000-0000-4000-8000-000000000022': 0, // reggaeton -> excluded
    },
  },

  // ------------------------------------------------------------------
  // COMPOSITION
  // ------------------------------------------------------------------
  {
    id: 'lively-but-can-talk',
    query: 'algo animado pero donde podamos hablar',
    labels: {
      '00000000-0000-4000-8000-000000000002': 3, // indie/funk, chat-friendly
      '00000000-0000-4000-8000-000000000013': 3, // bar for conversation
      '00000000-0000-4000-8000-000000000015': 3, // trivia is lively + talk
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000011': 2,
      '00000000-0000-4000-8000-000000000001': 0, // techno too loud to talk
      '00000000-0000-4000-8000-000000000006': 0,
      '00000000-0000-4000-8000-000000000007': 0, // reggaeton
      '00000000-0000-4000-8000-000000000022': 0,
    },
  },
  {
    id: 'romantic-but-affordable',
    query: 'algo romántico pero no caro',
    // No declared `must`: the budget constraint (maxPrice 15000) is applied via
    // the canonicalized intent.must.maxPrice, which the runner checks directly.
    toolInput: { maxPrice: 15000 },
    must: { maxPrice: 15000 },
    labels: {
      '00000000-0000-4000-8000-000000000012': 3, // intimate jazz, 12000 -> affordable
      '00000000-0000-4000-8000-000000000002': 1, // fun but not romantic
      '00000000-0000-4000-8000-000000000013': 1, // chill, not romantic
      '00000000-0000-4000-8000-000000000004': 0, // romantic dinner 25000 -> too pricey
    },
  },

  // ------------------------------------------------------------------
  // IMPOSSIBLE / NO-MATCH
  // ------------------------------------------------------------------
  {
    id: 'free-jazz-tomorrow-pilar',
    query: 'un concierto gratis de jazz mañana en Pilar',
    toolInput: { isFree: true, dateFrom: '2026-08-14', dateTo: '2026-08-15' },
    must: { isFree: true, within: WINDOW_DAY_0814 },
    labels: {},
    expectEmpty: true,
  },
  {
    id: 'free-reggaeton',
    query: 'reggaetón gratis',
    toolInput: { isFree: true },
    must: { isFree: true },
    labels: {
      '00000000-0000-4000-8000-000000000007': 0, // paid
      '00000000-0000-4000-8000-000000000022': 0, // paid
    },
    expectEmpty: true,
  },

  // ------------------------------------------------------------------
  // VAGUE
  // ------------------------------------------------------------------
  {
    id: 'pick-somewhere-good',
    query: 'pick somewhere good',
    // Vague request: several events are genuinely fine, so several get a 2.
    labels: {
      '00000000-0000-4000-8000-000000000004': 2,
      '00000000-0000-4000-8000-000000000008': 2,
      '00000000-0000-4000-8000-000000000001': 2,
      '00000000-0000-4000-8000-000000000012': 2,
      '00000000-0000-4000-8000-000000000013': 2,
      '00000000-0000-4000-8000-000000000016': 2,
    },
  },
  {
    id: 'sorpresa',
    query: 'sorpresa',
    labels: {
      '00000000-0000-4000-8000-000000000011': 3, // location-tba surprise
    },
  },

  // ------------------------------------------------------------------
  // GENERAL
  // ------------------------------------------------------------------
  {
    id: 'free-only',
    query: 'eventos gratis',
    toolInput: { isFree: true },
    must: { isFree: true },
    labels: {
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000005': 2,
      '00000000-0000-4000-8000-000000000008': 3,
      '00000000-0000-4000-8000-000000000009': 2,
      '00000000-0000-4000-8000-000000000010': 2,
      '00000000-0000-4000-8000-000000000011': 2,
      '00000000-0000-4000-8000-000000000015': 2,
      '00000000-0000-4000-8000-000000000016': 3,
      '00000000-0000-4000-8000-000000000019': 2,
      '00000000-0000-4000-8000-000000000020': 2,
      '00000000-0000-4000-8000-000000000023': 2, // also free (Thursday)
      '00000000-0000-4000-8000-000000000001': 0, // paid
    },
  },
  {
    id: 'weekend-general',
    query: 'planes para el fin de semana',
    toolInput: { timeFilter: 'weekend' },
    must: { within: WINDOW_WEEKEND },
    labels: {
      '00000000-0000-4000-8000-000000000001': 2,
      '00000000-0000-4000-8000-000000000002': 2,
      '00000000-0000-4000-8000-000000000003': 2,
      '00000000-0000-4000-8000-000000000004': 3,
      '00000000-0000-4000-8000-000000000005': 2,
      '00000000-0000-4000-8000-000000000006': 2,
      '00000000-0000-4000-8000-000000000007': 2,
      '00000000-0000-4000-8000-000000000008': 3,
      '00000000-0000-4000-8000-000000000009': 2,
      '00000000-0000-4000-8000-000000000010': 2,
      '00000000-0000-4000-8000-000000000011': 2,
      '00000000-0000-4000-8000-000000000012': 2,
      '00000000-0000-4000-8000-000000000013': 2,
      '00000000-0000-4000-8000-000000000015': 2,
      '00000000-0000-4000-8000-000000000016': 2,
      '00000000-0000-4000-8000-000000000017': 2,
      '00000000-0000-4000-8000-000000000019': 2,
      '00000000-0000-4000-8000-000000000020': 2,
      '00000000-0000-4000-8000-000000000022': 2,
      '00000000-0000-4000-8000-000000000023': 0, // Thursday
      '00000000-0000-4000-8000-000000000024': 0, // Friday
      '00000000-0000-4000-8000-000000000025': 0, // Friday
      '00000000-0000-4000-8000-000000000026': 0, // Friday
      '00000000-0000-4000-8000-000000000027': 0, // Friday 01:00 BA (after midnight)
    },
  },
]
