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

const anthropic = new Anthropic()

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
Escribe SOLO la descripción en español como texto plano, sin formato markdown ni encabezados.
Mantén menos de 200 palabras. Enfócate en conceptos buscables.`

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
Write ONLY the description in English as plain text, no markdown formatting or headers.
Keep under 200 words. Focus on searchable concepts.`

/**
 * Translation prompt - Spanish to English
 */
const TRANSLATION_ES_TO_EN = `Translate this Spanish event description to English.
Maintain the same tone, meaning, and style. Keep it concise.
Output ONLY the translated text, no explanations or additional commentary.`

/**
 * Translation prompt - English to Spanish
 */
const TRANSLATION_EN_TO_ES = `Translate this English event description to Spanish.
Maintain the same tone, meaning, and style. Keep it concise.
Output ONLY the translated text, no explanations or additional commentary.`

/**
 * Fetch a URL's content as markdown using Jina Reader
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
      console.error(`Jina fetch error for ${url}: ${response.status} ${response.statusText}`)
      return null
    }

    const markdown = await response.text()
    return markdown
  } catch (error) {
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

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: `${LANGUAGE_DETECTION_PROMPT}\n\n---\n${sample}\n---`,
        },
      ],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    const response = textBlock?.text?.toLowerCase().trim() ?? ''

    // Default to Spanish for Buenos Aires events if unclear
    if (response.includes('english')) {
      return 'english'
    }
    return 'spanish'
  } catch (error) {
    console.error(`Language detection error:`, error)
    // Default to Spanish for Buenos Aires context
    return 'spanish'
  }
}

/**
 * Extract a semantic event description from markdown using Haiku 4.5
 * Extracts in the specified language
 */
export async function extractDescription(
  markdown: string,
  language: DetectedLanguage
): Promise<string | null> {
  try {
    // Truncate markdown to avoid excessive tokens (keep first 15k chars)
    const truncatedMarkdown = markdown.slice(0, 15000)
    const prompt = language === 'spanish' ? EXTRACTION_PROMPT_ES : EXTRACTION_PROMPT_EN

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\n---\n${truncatedMarkdown}\n---`,
        },
      ],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    return textBlock?.text ?? null
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

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\n---\n${text}\n---`,
        },
      ],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    return textBlock?.text ?? null
  } catch (error) {
    console.error(`Haiku translation error:`, error)
    return null
  }
}


export interface BilingualDescription {
  description_es: string | null
  description_en: string | null
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
  console.log(`[enrichment] Starting bilingual enrichment for: ${url}${knownLanguage ? ` (known: ${knownLanguage})` : ''}`)

  // Step 1: Fetch markdown via Jina
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

  // Step 3: Extract description in source language
  console.log(`[enrichment] Extracting ${sourceLanguage} description with Haiku...`)
  const sourceDescription = await extractDescription(markdown, sourceLanguage)
  if (!sourceDescription) {
    console.log(`[enrichment] ${sourceLanguage} extraction failed`)
    return null
  }
  console.log(`[enrichment] ${sourceLanguage}: ${sourceDescription.substring(0, 100)}...`)

  // Step 4: Translate to other language
  let descriptionEs: string | null
  let descriptionEn: string | null

  if (sourceLanguage === 'spanish') {
    descriptionEs = sourceDescription
    console.log(`[enrichment] Translating to English with Haiku...`)
    descriptionEn = await translateText(sourceDescription, 'es-to-en')
    console.log(`[enrichment] English: ${descriptionEn ? descriptionEn.substring(0, 100) + '...' : 'null'}`)
  } else {
    descriptionEn = sourceDescription
    console.log(`[enrichment] Translating to Spanish with Haiku...`)
    descriptionEs = await translateText(sourceDescription, 'en-to-es')
    console.log(`[enrichment] Spanish: ${descriptionEs ? descriptionEs.substring(0, 100) + '...' : 'null'}`)
  }

  return {
    description_es: descriptionEs,
    description_en: descriptionEn,
  }
}

