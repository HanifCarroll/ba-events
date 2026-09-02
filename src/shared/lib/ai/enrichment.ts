/**
 * Event description enrichment using Jina Reader + the configured text model
 * (DeepSeek V4 Flash by default, via its Anthropic-compatible endpoint).
 *
 * Bilingual Pipeline:
 * 1. Jina Reader fetches page and converts to clean markdown
 * 2. The model extracts semantic description in Spanish (source language)
 * 3. The model translates to English for display
 *
 * The Spanish description is used for embeddings (cross-lingual model handles it)
 */

import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import { Effect } from 'effect'
import { textModel, NO_THINKING } from './providers.ts'
import { HttpError } from '../errors.ts'

// ============================================================================
// SCHEMAS
// ============================================================================

const LANGUAGE_SCHEMA = z.object({ language: z.enum(['spanish', 'english']) })
const DESCRIPTION_SCHEMA = z.object({ description: z.string() })
const SUMMARY_SCHEMA = z.object({ summary: z.string() })
const VENUE_SCHEMA = z.object({ venue_name: z.string().nullable() })

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/**
 * Get known language for a source.
 * Sources from Argentina are typically Spanish, others need detection.
 */
export function getKnownLanguageForSource(source: string): 'spanish' | 'english' | undefined {
  switch (source) {
    case 'passline':
    case 'ba-tourism':
      return 'spanish'
    default:
      return undefined // Auto-detect
  }
}

/**
 * Language detection prompt - quick classification
 */
const LANGUAGE_DETECTION_PROMPT = `What is the primary language of the main content in this text?
Ignore navigation, headers, and boilerplate. Focus on the event description content.
Reply with ONLY one word: "spanish" or "english" (lowercase, no punctuation).`

/**
 * Spanish extraction prompt - focused on semantic/experiential content
 * Avoids redundant structured data (dates, venues, prices) that's already in DB fields
 */
const EXTRACTION_PROMPT_ES = `Extrae una descripción semántica de este evento para indexación de búsqueda.

Enfócate en:
- El TIPO de experiencia (concierto, taller, proyección, fiesta, etc.)
- El AMBIENTE y vibra (íntimo, energético, casual, elegante, etc.)
- Qué lo hace ÚNICO o especial
- Para QUIÉN es ideal (amantes de la música, parejas, familias, etc.)
- Qué van a HACER o experimentar los asistentes
- Qué está INCLUIDO (comida, bebidas, materiales, etc.)

NO incluyas:
- Fechas, horarios o días específicos de la semana
- Nombres de lugares o direcciones (ya los tenemos por separado)
- Precios exactos (ya los tenemos por separado)
- Instrucciones de compra de entradas
- Información de contacto

Ignora menús de navegación, pies de página, texto legal y otro contenido genérico.

FORMATO: Escribe 2-3 párrafos cortos (2-3 oraciones cada uno) separados por líneas en blanco.
- Primer párrafo: qué es el evento
- Párrafos adicionales: ambiente, para quién es, qué incluye - SOLO si esta información existe en la fuente
- Si la fuente tiene poca información, está bien escribir solo 1-2 párrafos

Mantén menos de 200 palabras total.`

/**
 * English extraction prompt - same focus as Spanish version
 */
const EXTRACTION_PROMPT_EN = `Extract a semantic description of this event for search indexing.

Focus on:
- The TYPE of experience (concert, workshop, screening, party, etc.)
- The ATMOSPHERE and vibe (intimate, energetic, casual, elegant, etc.)
- What makes it UNIQUE or special
- WHO it's ideal for (music lovers, couples, families, etc.)
- What attendees will DO or experience
- What's INCLUDED (food, drinks, materials, etc.)

DO NOT include:
- Specific dates, times, or days of the week
- Venue names or addresses (we have those separately)
- Exact prices (we have those separately)
- Ticket purchase instructions
- Contact information

Ignore navigation menus, footers, legal text, and other generic content.

FORMAT: Write 2-3 short paragraphs (2-3 sentences each) separated by blank lines.
- First paragraph: what the event is
- Additional paragraphs: atmosphere, who it's for, what's included - ONLY if this info exists in the source
- If the source has limited info, it's fine to write just 1-2 paragraphs

Keep under 200 words total.`

/**
 * Translation prompt - Spanish to English
 */
const TRANSLATION_ES_TO_EN = `Translate this Spanish event description to English.
Maintain the same tone, meaning, style, and paragraph structure.
Preserve blank lines between paragraphs exactly as in the source.
Output ONLY the translated text, no explanations or additional commentary.`

/**
 * Translation prompt - English to Spanish
 */
const TRANSLATION_EN_TO_ES = `Translate this English event description to Spanish.
Maintain the same tone, meaning, style, and paragraph structure.
Preserve blank lines between paragraphs exactly as in the source.
Output ONLY the translated text, no explanations or additional commentary.`

/**
 * Card summary prompts - concise and punchy, no structured details.
 */
const SUMMARY_PROMPT_ES = `Resume esta descripción de evento en UNA frase breve para una tarjeta.

Reglas:
- Máximo 180 caracteres
- No incluir fecha, hora, dirección, precio o contacto
- Mantener solo la experiencia principal y vibra
- Texto plano (sin comillas, sin markdown)
- Sin prefijos como \"Resumen:\"`

const SUMMARY_PROMPT_EN = `Summarize this event description in ONE short sentence for a card.

Rules:
- Maximum 180 characters
- Do not include date, time, address, price, or contact details
- Keep only the core experience and vibe
- Plain text only (no quotes, no markdown)
- No prefixes like \"Summary:\"`

/**
 * Venue extraction prompt - extracts just the venue/location name
 * Used with structured outputs for guaranteed JSON response
 */
const VENUE_EXTRACTION_PROMPT = `Extract the venue name from this event page.

Look for:
- The physical venue/location name where the event takes place
- Check sections labeled "Venue", "Location", "Lugar", "Ubicación", "Dónde"
- The place name, not the full address

Set venue_name to null if:
- No specific physical venue is mentioned
- The event is online/virtual
- The location says "TBA", "To be announced", or similar
- Only an address is provided without a venue name

Examples of valid venue names:
- "Centro Cultural Kirchner"
- "Teatro Colón"
- "La Trastienda Club"

Examples that should return null:
- "Av. Corrientes 1234, CABA" (address only, no venue name)
- "Online event"
- "Location TBA"
- "Needs a location"`

/**
 * Fetch a URL's content as markdown using Jina Reader.
 * Throws HttpError for HTTP errors (404, 500, etc.) to allow callers to distinguish error types.
 * Returns null only for network errors (no response received).
 */
class JinaFetchError extends Error {
  readonly _tag = 'JinaFetchError'
}

export async function fetchWithJina(url: string): Promise<string | null> {
  const jinaUrl = `https://r.jina.ai/${url}`

  const program = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(jinaUrl, { headers: { Accept: 'text/markdown' } }),
      catch: (error) => new JinaFetchError(error instanceof Error ? error.message : String(error)),
    })

    if (!response.ok) {
      return yield* Effect.fail(new HttpError(response.status, response.statusText, url))
    }

    return yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => new JinaFetchError(error instanceof Error ? error.message : String(error)),
    })
  })

  try {
    return await Effect.runPromise(program)
  } catch (error) {
    // Re-throw HttpError as-is for upstream handling. Network/body failures
    // retain the null fallback used by the enrichment pipeline.
    if (error instanceof HttpError) throw error
    console.error(`Jina fetch error for ${url}:`, error)
    return null
  }
}

type DetectedLanguage = 'spanish' | 'english'

/**
 * Detect the primary language of markdown content using Haiku 4.5
 * Uses a small sample to minimize tokens
 */
export async function detectLanguage(markdown: string): Promise<DetectedLanguage> {
  try {
    // Use a smaller sample for language detection (first 3k chars)
    const sample = markdown.slice(0, 3000)

    const { object } = await generateObject({
      model: textModel,
      schema: LANGUAGE_SCHEMA,
      prompt: `${LANGUAGE_DETECTION_PROMPT}\n\n---\n${sample}\n---`,
      ...NO_THINKING,
    })

    return object.language
  } catch (error) {
    console.error(`Language detection error:`, error)
    // Default to Spanish for Buenos Aires context
    return 'spanish'
  }
}

/**
 * Extract a semantic event description from markdown.
 * Extracts in the specified language.
 */
export async function extractDescription(
  markdown: string,
  language: DetectedLanguage
): Promise<string | null> {
  try {
    // Truncate markdown to avoid excessive tokens (keep first 15k chars)
    const truncatedMarkdown = markdown.slice(0, 15000)
    const prompt = language === 'spanish' ? EXTRACTION_PROMPT_ES : EXTRACTION_PROMPT_EN

    const { object } = await generateObject({
      model: textModel,
      schema: DESCRIPTION_SCHEMA,
      prompt: `${prompt}\n\n---\n${truncatedMarkdown}\n---`,
      ...NO_THINKING,
    })

    return object.description || null
  } catch (error) {
    console.error(`Description extraction error:`, error)
    return null
  }
}

/**
 * Generate a short card summary from an existing description.
 */
export async function generateDescriptionSummary(
  description: string,
  language: DetectedLanguage
): Promise<string | null> {
  if (!description.trim()) return null

  try {
    const prompt = language === 'spanish' ? SUMMARY_PROMPT_ES : SUMMARY_PROMPT_EN
    const text = description.slice(0, 2500)

    const { object } = await generateObject({
      model: textModel,
      schema: SUMMARY_SCHEMA,
      prompt: `${prompt}\n\n---\n${text}\n---`,
      ...NO_THINKING,
    })

    const summary = object.summary.trim()
    if (!summary) return null

    return summary.length <= 180 ? summary : `${summary.slice(0, 179).trim()}…`
  } catch (error) {
    console.error('Summary generation error:', error)
    return null
  }
}

/**
 * Translate text between Spanish and English.
 */
export async function translateText(
  text: string,
  direction: 'es-to-en' | 'en-to-es'
): Promise<string | null> {
  try {
    const prompt = direction === 'es-to-en' ? TRANSLATION_ES_TO_EN : TRANSLATION_EN_TO_ES

    const { text: translated } = await generateText({
      model: textModel,
      prompt: `${prompt}\n\n---\n${text}\n---`,
      ...NO_THINKING,
    })

    return translated || null
  } catch (error) {
    console.error(`Translation error:`, error)
    return null
  }
}

/**
 * Extract venue name from markdown content.
 * Returns the venue name or null if no physical venue found.
 */
export async function extractVenueName(markdown: string): Promise<string | null> {
  try {
    // Use a moderate sample for venue extraction (first 10k chars)
    const truncatedMarkdown = markdown.slice(0, 10000)

    const { object } = await generateObject({
      model: textModel,
      schema: VENUE_SCHEMA,
      prompt: `${VENUE_EXTRACTION_PROMPT}\n\n---\n${truncatedMarkdown}\n---`,
      ...NO_THINKING,
    })

    // venue_name is either a string or null
    return object.venue_name
  } catch (error) {
    console.error(`Venue extraction error:`, error)
    return null
  }
}


export interface BilingualDescription {
  description_es: string | null
  description_en: string | null
}

/**
 * Translate a description to both Spanish and English
 */
async function translateToBilingual(
  sourceDescription: string,
  sourceLanguage: 'spanish' | 'english'
): Promise<BilingualDescription> {
  if (sourceLanguage === 'spanish') {
    console.log(`[enrichment] Translating to English with Haiku...`)
    const descriptionEn = await translateText(sourceDescription, 'es-to-en')
    console.log(`[enrichment] English: ${descriptionEn ? descriptionEn.substring(0, 100) + '...' : 'null'}`)
    return { description_es: sourceDescription, description_en: descriptionEn }
  }
  console.log(`[enrichment] Translating to Spanish with Haiku...`)
  const descriptionEs = await translateText(sourceDescription, 'en-to-es')
  console.log(`[enrichment] Spanish: ${descriptionEs ? descriptionEs.substring(0, 100) + '...' : 'null'}`)
  return { description_es: descriptionEs, description_en: sourceDescription }
}

/**
 * Combined bilingual pipeline with optional language detection
 * 1. Jina Reader fetches page as markdown
 * 2. Use known language OR detect source language
 * 3. Extract description in source language
 * 4. Translate to other language
 *
 * @param url - The event page URL
 * @param knownLanguage - If provided, skip detection (e.g., 'spanish' for Passline/BA Tourism)
 */
export async function enrichEventDescriptionBilingual(
  url: string,
  knownLanguage?: 'spanish' | 'english'
): Promise<BilingualDescription | null> {
  // Delegate to enrichEventFull without venue extraction
  const result = await enrichEventFull(url, { knownLanguage, extractVenue: false })
  if (!result) return null
  return { description_es: result.description_es, description_en: result.description_en }
}

/**
 * Full enrichment result including venue extraction
 */
export interface FullEnrichmentResult {
  description_es: string | null
  description_en: string | null
  venue_name: string | null
}

/**
 * Combined enrichment pipeline that extracts both description and venue name
 * Fetches page once with Jina, then extracts both in parallel
 *
 * @param url - The event page URL
 * @param options.knownLanguage - If provided, skip detection (e.g., 'spanish' for Passline/BA Tourism)
 * @param options.extractVenue - Whether to extract venue name (default: true)
 */
export async function enrichEventFull(
  url: string,
  options?: {
    knownLanguage?: 'spanish' | 'english'
    extractVenue?: boolean
  }
): Promise<FullEnrichmentResult | null> {
  const { knownLanguage, extractVenue = true } = options ?? {}

  console.log(`[enrichment] Starting full enrichment for: ${url}${knownLanguage ? ` (known: ${knownLanguage})` : ''}`)

  // Step 1: Fetch markdown via Jina (once for all extractions)
  console.log(`[enrichment] Fetching via Jina...`)
  const markdown = await fetchWithJina(url)
  if (!markdown) {
    console.log(`[enrichment] Jina fetch failed`)
    return null
  }
  console.log(`[enrichment] Jina returned ${markdown.length} chars`)

  // Step 2: Use known language or detect
  let sourceLanguage: 'spanish' | 'english'
  if (knownLanguage) {
    sourceLanguage = knownLanguage
    console.log(`[enrichment] Using known language: ${sourceLanguage}`)
  } else {
    console.log(`[enrichment] Detecting language...`)
    sourceLanguage = await detectLanguage(markdown)
    console.log(`[enrichment] Detected language: ${sourceLanguage}`)
  }

  // Step 3: Extract description and venue in parallel
  console.log(`[enrichment] Extracting description and ${extractVenue ? 'venue' : 'skipping venue'}...`)

  const [sourceDescription, venueName] = await Promise.all([
    extractDescription(markdown, sourceLanguage),
    extractVenue ? extractVenueName(markdown) : Promise.resolve(null),
  ])

  if (!sourceDescription) {
    console.log(`[enrichment] ${sourceLanguage} extraction failed`)
    // Still return venue if we got it
    if (venueName) {
      console.log(`[enrichment] Got venue but no description: ${venueName}`)
      return {
        description_es: null,
        description_en: null,
        venue_name: venueName,
      }
    }
    return null
  }

  console.log(`[enrichment] ${sourceLanguage}: ${sourceDescription.substring(0, 100)}...`)
  if (venueName) {
    console.log(`[enrichment] Venue: ${venueName}`)
  }

  // Step 4: Translate description to other language
  const bilingual = await translateToBilingual(sourceDescription, sourceLanguage)

  return {
    ...bilingual,
    venue_name: venueName,
  }
}

/**
 * Extract only venue name from a URL (for events that already have descriptions)
 * Lighter weight than full enrichment - skips description extraction
 */
export async function extractVenueFromUrl(url: string): Promise<string | null> {
  console.log(`[enrichment] Extracting venue only for: ${url}`)

  const markdown = await fetchWithJina(url)
  if (!markdown) {
    console.log(`[enrichment] Jina fetch failed`)
    return null
  }

  const venueName = await extractVenueName(markdown)
  if (venueName) {
    console.log(`[enrichment] Found venue: ${venueName}`)
  } else {
    console.log(`[enrichment] No venue found`)
  }

  return venueName
}
