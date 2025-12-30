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
 * Translation prompt - Spanish to English
 */
const TRANSLATION_PROMPT = `Translate this Spanish event description to English.
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

/**
 * Extract a semantic event description in Spanish from markdown using Haiku 4.5
 */
export async function extractDescriptionInSpanish(markdown: string): Promise<string | null> {
  try {
    // Truncate markdown to avoid excessive tokens (keep first 15k chars)
    const truncatedMarkdown = markdown.slice(0, 15000)

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT_ES}\n\n---\n${truncatedMarkdown}\n---`,
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
 * Translate Spanish text to English using Haiku 4.5
 */
export async function translateToEnglish(spanishText: string): Promise<string | null> {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `${TRANSLATION_PROMPT}\n\n---\n${spanishText}\n---`,
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
 * Combined bilingual pipeline: Jina fetch + Spanish extraction + English translation
 */
export async function enrichEventDescriptionBilingual(url: string): Promise<BilingualDescription | null> {
  console.log(`[enrichment] Starting bilingual enrichment for: ${url}`)

  // Step 1: Fetch markdown via Jina
  console.log(`[enrichment] Fetching via Jina...`)
  const markdown = await fetchWithJina(url)
  if (!markdown) {
    console.log(`[enrichment] Jina fetch failed`)
    return null
  }
  console.log(`[enrichment] Jina returned ${markdown.length} chars`)

  // Step 2: Extract description in Spanish
  console.log(`[enrichment] Extracting Spanish description with Haiku...`)
  const descriptionEs = await extractDescriptionInSpanish(markdown)
  if (!descriptionEs) {
    console.log(`[enrichment] Spanish extraction failed`)
    return null
  }
  console.log(`[enrichment] Spanish: ${descriptionEs.substring(0, 100)}...`)

  // Step 3: Translate to English
  console.log(`[enrichment] Translating to English with Haiku...`)
  const descriptionEn = await translateToEnglish(descriptionEs)
  console.log(`[enrichment] English: ${descriptionEn ? descriptionEn.substring(0, 100) + '...' : 'null'}`)

  return {
    description_es: descriptionEs,
    description_en: descriptionEn,
  }
}

export interface BilingualEnrichmentResult {
  id: string
  description_es: string | null
  description_en: string | null
  error?: string
}

/**
 * Batch enrich multiple events with bilingual descriptions
 * Processes sequentially to avoid rate limiting
 */
export async function enrichEventDescriptionsBatchBilingual(
  events: Array<{ id: string; link: string }>,
  onProgress?: (current: number, total: number) => void,
  delayMs: number = 500
): Promise<BilingualEnrichmentResult[]> {
  const results: BilingualEnrichmentResult[] = []

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    onProgress?.(i + 1, events.length)

    try {
      const bilingual = await enrichEventDescriptionBilingual(event.link)
      results.push({
        id: event.id,
        description_es: bilingual?.description_es ?? null,
        description_en: bilingual?.description_en ?? null,
        error: bilingual?.description_es ? undefined : 'Failed to extract description',
      })
    } catch (error) {
      results.push({
        id: event.id,
        description_es: null,
        description_en: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Add delay between requests to avoid rate limiting
    if (i < events.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}
