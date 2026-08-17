#!/usr/bin/env bun
/**
 * Deterministic scorers for concierge evals: voice rules and reply language.
 * The concierge writes no model prose (server text is deterministic), so these
 * mostly pin the deterministic EN/ES materialization.
 */

// Voice regressions remain checked even though current visible prose comes only
// from deterministic templates.
export const META_NARRATION_PATTERN =
  /\b(?:let me\s+(?:check|search|look|try)|search(?:ing now| again)|still getting|different angle)\b/i

const EXCLAIM_OPENER =
  /^(great|perfect|absolutely|awesome|amazing|excellent|love it|genial|perfecto|buen[ií]simo|excelente|me encanta)[\s!,]/i

const PRESSURE_PHRASING =
  /(don'?t miss out|if you dare|chicken out|before it'?s too late|no te (lo )?pierdas|si te anim[aá]s|te vas a arrepentir)/i

const ES_STOPWORDS =
  /\b(el|la|los|las|un|una|de|del|que|para|con|esta|este|hoy|noche|evento|eventos|hay|ten[eé]s|ac[aá]|muy|m[aá]s|and[aá]|vamos|si quer[eé]s)\b/gi
const EN_STOPWORDS =
  /\b(the|a|an|and|to|tonight|go|this|that|with|for|at|in|is|are|you|your|it|here|there)\b/gi

/**
 * A voice-rule violation with severity.
 * `blocking: true` fails the case outright; `blocking: false` is cosmetic and
 * only fails if it repeats (>= 2 in one reply).
 */
export interface VoiceViolation {
  kind: string
  blocking: boolean
}

/** Voice rules every concierge reply should satisfy, tiered by severity. */
export function voiceViolations(text: string): VoiceViolation[] {
  const violations: VoiceViolation[] = []
  if (!text.trim()) return [{ kind: 'empty reply text', blocking: true }]
  if (META_NARRATION_PATTERN.test(text)) {
    violations.push({ kind: 'meta-narration of tool work', blocking: false })
  }
  if (EXCLAIM_OPENER.test(text)) {
    violations.push({ kind: 'opens with exclamation/enthusiasm word', blocking: false })
  }
  if (PRESSURE_PHRASING.test(text)) {
    violations.push({ kind: 'pressure/teasing phrasing', blocking: true })
  }
  return violations
}

/** Heuristic language detection good enough for eval assertions. */
export function detectLanguage(text: string): 'en' | 'es' {
  const accents = (text.match(/[áéíóúñü¿¡]/gi) ?? []).length
  const esWords = (text.match(ES_STOPWORDS) ?? []).length
  const enWords = (text.match(EN_STOPWORDS) ?? []).length
  return accents + esWords > enWords ? 'es' : 'en'
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
