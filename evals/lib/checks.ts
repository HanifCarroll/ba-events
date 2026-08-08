#!/usr/bin/env bun
/**
 * Deterministic scorers for concierge evals: voice rules from the concierge
 * prompt (src/features/chat/api/prompts/concierge.ts) and reply language.
 */

// Keep in sync with META_NARRATION_PATTERN in src/routes/api/chat.ts
const META_NARRATION_PATTERN =
  /\b(let me|i(?:'m| am| ll|'ll)\s+(?:check|search|look|try)|still getting|different angle|search again|looking for)\b/i

const EXCLAIM_OPENER =
  /^(great|perfect|absolutely|awesome|amazing|excellent|love it|genial|perfecto|buen[ií]simo|excelente|me encanta)[\s!,]/i

const PRESSURE_PHRASING =
  /(don'?t miss out|if you dare|chicken out|before it'?s too late|no te (lo )?pierdas|si te anim[aá]s|te vas a arrepentir)/i

const ES_STOPWORDS =
  /\b(el|la|los|las|un|una|de|del|que|para|con|esta|este|hoy|noche|evento|eventos|hay|ten[eé]s|ac[aá]|muy|m[aá]s|and[aá]|vamos|si quer[eé]s)\b/gi
const EN_STOPWORDS =
  /\b(the|a|an|and|to|tonight|go|this|that|with|for|at|in|is|are|you|your|it|here|there)\b/gi

/** Voice rules every concierge reply must satisfy. Returns violation descriptions. */
export function voiceViolations(text: string): string[] {
  const violations: string[] = []
  if (!text.trim()) return ['empty reply text']
  if (META_NARRATION_PATTERN.test(text)) violations.push('meta-narration of tool work')
  if (EXCLAIM_OPENER.test(text)) violations.push('opens with exclamation/enthusiasm word')
  if (PRESSURE_PHRASING.test(text)) violations.push('pressure/teasing phrasing')
  return violations
}

/** Heuristic language detection good enough for eval assertions. */
export function detectLanguage(text: string): 'en' | 'es' {
  const accents = (text.match(/[áéíóúñü¿¡]/gi) ?? []).length
  const esWords = (text.match(ES_STOPWORDS) ?? []).length
  const enWords = (text.match(EN_STOPWORDS) ?? []).length
  return accents + esWords > enWords ? 'es' : 'en'
}

/**
 * Check the reply mentions at least one event the tools actually returned.
 * Matches on distinctive name tokens (>=5 chars) so paraphrases like
 * "Smoked" for "Smoked, Festival de Ahumados" count.
 */
export function mentionsReturnedEvent(text: string, eventNames: string[]): boolean {
  const lower = text.toLowerCase()
  return eventNames.some((name) =>
    name
      .toLowerCase()
      .split(/[^a-záéíóúñü0-9]+/i)
      .filter((w) => w.length >= 5)
      .some((word) => lower.includes(word))
  )
}

/** Run async tasks with bounded concurrency. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const i = index++
        results[i] = await fn(items[i])
      }
    })
  )
  return results
}
