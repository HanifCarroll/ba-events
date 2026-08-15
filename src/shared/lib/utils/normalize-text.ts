/**
 * Shared text normalization for token-boundary matching.
 *
 * Lowercase, strip diacritics, collapse punctuation and whitespace.
 * "Ortúzar", "ORTUZAR" and "ortuzar" all become "ortuzar".
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
