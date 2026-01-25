/**
 * Event description enrichment using Jina Reader + Claude Haiku 4.5
 *
 * Bilingual Pipeline:
 * 1. Jina Reader fetches page and converts to clean markdown
 * 2. Haiku 4.5 extracts semantic description in Spanish (source language)
 * 3. Haiku 4.5 translates to English for display
 *
 * The Spanish description is used for embeddings (cross-lingual model handles it)
 */

import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODEL } from './constants'
import { HttpError } from '../errors'

// Lazy initialization to avoid instantiating in browser bundle
let anthropicClient: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic()
  }
  return anthropicClient
}

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
 * Extract text content from Claude's response
 */
function extractTextFromResponse(message: Anthropic.Message): string | null {
  const textBlock = message.content.find((block) => block.type === 'text')
  return textBlock?.text ?? null
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
 * JSON schema for venue extraction response
 * Using structured outputs guarantees this exact format
 */
const VENUE_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    venue_name: {
      type: ['string', 'null'],
      description: 'The venue name, or null if no physical venue is specified',
    },
  },
  required: ['venue_name'],
  additionalProperties: false,
} as const

/**
 * JSON schema for description extraction response
 * Using structured outputs guarantees clean description without prefixes
 */
const DESCRIPTION_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'The semantic event description as plain text, no prefixes or headers',
    },
  },
  required: ['description'],
  additionalProperties: false,
} as const

/**
 * Fetch a URL's content as markdown using Jina Reader.
 * Throws HttpError for HTTP errors (404, 500, etc.) to allow callers to distinguish error types.
 * Returns null only for network errors (no response received).
 */
export async function fetchWithJina(url: string): Promise<string | null> {
  const jinaUrl = `https://r.jina.ai/${url}`

  try {
    const response = await fetch(jinaUrl, {
      headers: {
        Accept: 'text/markdown',
      },
    })

    if (!response.ok) {
      // Jina returns HTTP errors that reflect the original page status
      // Throw HttpError so callers can detect 404s and mark events as canceled
      throw new HttpError(response.status, response.statusText, url)
    }

    const markdown = await response.text()
    return markdown
  } catch (error) {
    // Re-throw HttpError as-is for upstream handling
    if (error instanceof HttpError) {
      throw error
    }
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

    const message = await getAnthropicClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: `${LANGUAGE_DETECTION_PROMPT}\n\n---\n${sample}\n---`,
        },
      ],
    })

    const response = extractTextFromResponse(message)?.toLowerCase().trim() ?? ''

    // Default to Spanish for Buenos Aires events if unclear
    return response.includes('english') ? 'english' : 'spanish'
  } catch (error) {
    console.error(`Language detection error:`, error)
    // Default to Spanish for Buenos Aires context
    return 'spanish'
  }
}

/**
 * Response type for description extraction with structured outputs
 */
interface DescriptionExtractionResponse {
  description: string
}

/**
 * Extract a semantic event description from markdown using Haiku 4.5 with structured outputs.
 * Uses constrained decoding to guarantee clean description without prefixes.
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

    // Use structured outputs beta API for guaranteed JSON response
    const message = await getAnthropicClient().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      betas: [STRUCTURED_OUTPUTS_BETA],
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\n---\n${truncatedMarkdown}\n---`,
        },
      ],
      output_format: {
        type: 'json_schema',
        schema: DESCRIPTION_EXTRACTION_SCHEMA,
      },
    })

    // With structured outputs, response is guaranteed to be valid JSON
    const textBlock = message.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      console.error('[extractDescription] No text block in response')
      return null
    }

    const result = JSON.parse(textBlock.text) as DescriptionExtractionResponse
    return result.description || null
  } catch (error) {
    console.error(`Haiku extraction error:`, error)
    return null
  }
}

/**
 * Translate text between Spanish and English using Haiku 4.5
 */
export async function translateText(
  text: string,
  direction: 'es-to-en' | 'en-to-es'
): Promise<string | null> {
  try {
    const prompt = direction === 'es-to-en' ? TRANSLATION_ES_TO_EN : TRANSLATION_EN_TO_ES

    const message = await getAnthropicClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\n---\n${text}\n---`,
        },
      ],
    })

    return extractTextFromResponse(message)
  } catch (error) {
    console.error(`Haiku translation error:`, error)
    return null
  }
}

/**
 * Response type for venue extraction with structured outputs
 */
interface VenueExtractionResponse {
  venue_name: string | null
}

/**
 * Structured outputs beta header
 */
const STRUCTURED_OUTPUTS_BETA = 'structured-outputs-2025-11-13'

/**
 * Extract venue name from markdown content using Haiku 4.5 with structured outputs.
 * Uses constrained decoding to guarantee valid JSON response format.
 * Returns the venue name or null if no physical venue found.
 */
export async function extractVenueName(markdown: string): Promise<string | null> {
  try {
    // Use a moderate sample for venue extraction (first 10k chars)
    const truncatedMarkdown = markdown.slice(0, 10000)

    // Use structured outputs beta API for guaranteed JSON response
    const message = await getAnthropicClient().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 100,
      betas: [STRUCTURED_OUTPUTS_BETA],
      messages: [
        {
          role: 'user',
          content: `${VENUE_EXTRACTION_PROMPT}\n\n---\n${truncatedMarkdown}\n---`,
        },
      ],
      output_format: {
        type: 'json_schema',
        schema: VENUE_EXTRACTION_SCHEMA,
      },
    })

    // With structured outputs, response is guaranteed to be valid JSON
    const textBlock = message.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      console.error('[extractVenueName] No text block in response')
      return null
    }

    const result = JSON.parse(textBlock.text) as VenueExtractionResponse

    // Return the venue_name directly - it's either a string or null
    // No need for pattern matching since structured outputs guarantee the format
    return result.venue_name
  } catch (error) {
    console.error(`Haiku venue extraction error:`, error)
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

