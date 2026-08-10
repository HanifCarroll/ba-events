/**
 * Coverage Claim Guard
 *
 * Deterministic post-generation safety net for the reproduced failure where the
 * model narrows its search (e.g. timeFilter "week") and then asserts an
 * absolute coverage ceiling — "that's the furthest one out I've got", "my
 * calendar only covers this coming weekend" — as if no events exist beyond the
 * window it actually searched.
 *
 * When the final assistant text makes such a claim AND the searched window's
 * upper bound is before the true furthest event date on record, this appends a
 * grounded correction so the user is never left with a false ceiling.
 *
 * Fails open: any missing/ambiguous input returns the original text unchanged.
 */

import { formatInTimeZone } from 'date-fns-tz'
import { BA_TIMEZONE } from '@/shared/lib/constants'

export interface CoverageInfo {
  /** UTC ISO upper bound of the window the model actually searched (null = unbounded). */
  searchedTo?: string | null
  /** UTC ISO of the furthest scheduled event date on record (source of truth). */
  maxEventDate?: string | null
}

// Absolute ceiling / absence-of-events claims the model should not make when it
// only searched a bounded window. Groups:
//  1. "no events after/past/beyond X", "nothing further ahead"
//  2. "only covers/reaches/lists/goes through X", "coverage ends/stops at X"
//  3. "furthest/farthest ... I've got / I can / that's it"
// Spanish mirrors (es is the base locale): "no hay eventos después/más allá",
// "solo hay/cubre/llega hasta", "es lo más lejos que puedo llegar".
const CEILING_CLAIM_RE =
  /\b(?:no|nothing|not|don['’]t|doesn['’]t|can['’]t|cannot|won['’]t)\b[^.!?]{0,90}\b(?:after|past|beyond|further|farther|ahead)\b|\b(?:only|just)\s+(?:covers|reaches|shows|lists|runs|goes|has|includes|spans|gets)\b|\bcoverage\s+(?:ends|stops|covers|reaches|runs|goes)\b|\b(?:furthest|farthest)\b[^.!?]{0,60}\b(?:i['’]?ve got|i (?:can|could|have)|that['’]?s (?:it|all|about|the extent))\b|\bno hay (?:eventos|nada|más)\b[^.!?]{0,60}\b(?:después|más allá|más adelante|más lejos|pasado)\b|\b(?:solo|sólo|solamente)\s+(?:hay|cubre|alcanza|llega|incluye|muestra|tiene|tengo|existen)\b|\bes lo más (?:lejos|largo|adelante) que\b|\bhasta ahí (?:llega|llego|termina|termina el|se termina)\b/i

function buildNote(locale: 'en' | 'es', horizon: string, searched: string): string {
  if (locale === 'es') {
    return (
      `\n\nNota: nuestro calendario en realidad llega hasta el ${horizon} — ` +
      `mi última búsqueda solo cubrió hasta el ${searched}. ¿Querés que busque más allá?`
    )
  }
  return (
    `\n\nNote: our calendar actually lists events through ${horizon} — ` +
    `my last search only covered through ${searched}. Want me to look further?`
  )
}

export function guardCoverageClaims(
  text: string,
  locale: 'en' | 'es',
  coverage?: CoverageInfo | null
): string {
  // Fail open: no text, no coverage, or a missing horizon → leave unchanged.
  if (!text || !coverage?.maxEventDate || !coverage.searchedTo) return text

  const searched = new Date(coverage.searchedTo).getTime()
  const horizon = new Date(coverage.maxEventDate).getTime()
  if (!Number.isFinite(searched) || !Number.isFinite(horizon)) return text

  // Only intervene when the model actually bounded its search short of the
  // true horizon AND made an absolute ceiling/absence claim.
  if (searched >= horizon) return text
  if (!CEILING_CLAIM_RE.test(text)) return text

  const horizonFmt = formatInTimeZone(coverage.maxEventDate, BA_TIMEZONE, 'MMM d, yyyy')
  const searchedFmt = formatInTimeZone(coverage.searchedTo, BA_TIMEZONE, 'MMM d, yyyy')

  return text + buildNote(locale, horizonFmt, searchedFmt)
}
