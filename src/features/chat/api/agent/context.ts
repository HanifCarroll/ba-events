/**
 * Bounded model-context + response-language helpers (v5 replacement).
 *
 * The deterministic natural-language action/target/mutation regex parser that
 * lived here is gone: the planner (single `generateText` + closed `TurnPlan`)
 * interprets EN/ES natural language itself. This module keeps only the
 * deterministic response-language detection and the user-text bound, so the
 * server can localize deterministic text without a model call.
 */

import { sanitizeText } from './follow-up.ts'

/** Cap on a single user message's retained text. */
export const MAX_USER_TEXT = 2000

// ============================================================================
// RESPONSE LANGUAGE DETECTION (deterministic; UI locale is only a fallback)
// ============================================================================

const ES_LANGUAGE_WORDS = [
  'que', 'como', 'donde', 'cuando', 'cual', 'quiero', 'busco', 'busca', 'buscame',
  'encontra', 'dame', 'mostrame', 'evento', 'eventos', 'guardar', 'guarda', 'guardalo',
  'saca', 'quita', 'para', 'gratis', 'hoy', 'manana', 'noche', 'opciones', 'recomendame',
  'tenes', 'queres', 'alguna', 'algun', 'algo', 'este', 'esta', 'ese', 'esa', 'hay',
  'lugares', 'barrio', 'fin', 'semana',
]

const EN_LANGUAGE_WORDS = [
  'the', 'find', 'search', 'show', 'what', 'where', 'when', 'which', 'events', 'event',
  'save', 'for', 'with', 'this', 'that', 'tonight', 'weekend', 'free', 'options',
  'recommend', 'looking', 'anything', 'happening', 'some', 'night', 'you', 'want',
]

/**
 * Derive the response language from the latest user message; the UI locale is
 * only a fallback when the message is empty or language-neutral. Deterministic
 * and cheap (no model call): accented/inverted-punctuation text is a strong
 * Spanish signal, otherwise distinctive EN vs ES function/content words score.
 */
export function detectResponseLanguage(text: string, fallback: 'en' | 'es'): 'en' | 'es' {
  const raw = sanitizeText(text, MAX_USER_TEXT).toLowerCase()
  if (!raw) return fallback
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  let es = 0
  let en = 0
  if (/[áéíóúñü¿¡]/.test(raw)) es += 3

  for (const w of ES_LANGUAGE_WORDS) if (new RegExp(`\\b${w}\\b`).test(normalized)) es += 1
  for (const w of EN_LANGUAGE_WORDS) if (new RegExp(`\\b${w}\\b`).test(normalized)) en += 1

  if (es > en) return 'es'
  if (en > es) return 'en'
  return fallback
}
