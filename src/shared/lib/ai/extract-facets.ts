/**
 * Structured facet extraction (Phase 5).
 *
 * Given an event's name + bilingual descriptions + categories, extract the
 * closed-vocabulary faceted attributes via `generateObject` (schema-validated
 * against `eventFacetsSchema`, DeepSeek thinking disabled).
 *
 * Rules:
 *   - Only assign a facet key the source text actually supports. Empty arrays
 *     are the correct answer when there is no evidence.
 *   - Values are stored as canonical ENGLISH keys, even from Spanish text.
 *   - Do NOT infer `romantic` from the word "dinner" alone.
 *   - Both Spanish and English descriptions are passed in.
 *   - On `generateObject` failure we return `{}` and log — extracting one
 *     event must never fail the whole enrichment run.
 */
import { generateObject } from 'ai'
import { logger } from '#shared/lib/logger.ts'
import { textModel, NO_THINKING } from './providers.ts'
import {
  EVENT_TYPE_VALUES,
  GENRE_VALUES,
  VIBE_VALUES,
  ACTIVITY_VALUES,
  AUDIENCE_VALUES,
  SETTING_VALUES,
  eventFacetsSchema,
  type EventFacets,
} from '#shared/lib/search-facets.ts'

export interface ExtractFacetsInput {
  name: string
  description_es?: string | null
  description_en?: string | null
  categories?: string[] | null
}

// The failure fallback is the LITERAL empty object `{}` — NOT the parsed
// default `eventFacetsSchema.parse({})`, which expands to six empty arrays.
// An empty object is valid jsonb and lets `isEmptyFacets` treat it as empty so
// `getEventsNeedingEnrichment` never sees it as already-done and skips retry.
// The `as EventFacets` cast is runtime-void (the object stays `{}`) and only
// satisfies the TS return type; persistence treats it as the column default.
const EMPTY = Object.freeze({}) as EventFacets

const FACETS_EXTRACTION_PROMPT = `Classify this event into structured, closed-vocabulary search facets.

Use ONLY the canonical English facet values listed below. Do not invent values.

EVENT TYPE — pick 0+ of these (what the event is):
${EVENT_TYPE_VALUES.join(', ')}

GENRES — music genres ONLY if clearly present in the text (0+):
${GENRE_VALUES.join(', ')}

VIBES — the atmosphere / feel (0+):
${VIBE_VALUES.join(', ')}

ACTIVITIES — what attendees will DO (0+):
${ACTIVITY_VALUES.join(', ')}

AUDIENCE — who it's ideal for (0+):
${AUDIENCE_VALUES.join(', ')}

SETTING — indoor / outdoor, seated / standing (0+):
${SETTING_VALUES.join(', ')}

ENERGY — 'low' | 'medium' | 'high' (omit if not clear)
SOCIAL INTERACTION — 'low' | 'medium' | 'high' (omit if not clear)

RULES
- Only assign a facet if the source text SUPPORTS it. Empty arrays are correct
  when there is no evidence. Do not guess.
- Do NOT infer "romantic" from "dinner" alone — an event can be a dinner
  without being romantic. Only mark romantic if the text says it is.
- Do NOT infer a music genre from the event category alone; require real genre
  evidence in the name or descriptions.
- Translate Spanish words to the English canonical value (e.g. "jazz en vivo"
  → genres: ["jazz"], "Íntimo" → vibes: ["intimate"]).

Event name: {name}
Categories: {categories}
Description (ES): {description_es}
Description (EN): {description_en}

Return strictly valid JSON matching the schema.`

/**
 * Extract structured facets for an event. On failure returns `{}` and logs;
 * never throws.
 */
export async function extractEventFacets(input: ExtractFacetsInput): Promise<EventFacets> {
  const { name, description_es, description_en, categories } = input

  // Nothing to base facets on.
  if (!description_es && !description_en) {
    return EMPTY
  }

  const prompt = FACETS_EXTRACTION_PROMPT
    .replace('{name}', name || '')
    .replace('{categories}', categories?.length ? categories.join(', ') : 'none')
    .replace('{description_es}', description_es || 'n/a')
    .replace('{description_en}', description_en || 'n/a')

  try {
    const { object } = await generateObject({
      model: textModel,
      schema: eventFacetsSchema,
      prompt,
      ...NO_THINKING,
    })
    return object
  } catch (error) {
    logger.warn(`[extract-facets] extraction failed, returning empty facets: ${String(error)}`, {
      eventName: name,
    })
    return EMPTY
  }
}
