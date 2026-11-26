import { describe, expect, it } from 'vitest'
import { generateSuggestions } from './suggestions.ts'

const results = Array.from({ length: 2 }, () => ({
  categories: [], is_free: false, price: null, venue_neighborhood: 'Palermo' as const,
}))

describe('generateSuggestions', () => {
  it.each([
    [undefined, 1, false], [1, 1, false], [4, 4, false], [5, 4, true],
  ] as const)('offers alternatives only if eligible matches (%s) exceed shown matches (%s)', (totalMatches, shownMatches, offers) => {
    const suggestions = generateSuggestions({ originalQuery: '¿Qué hay hoy?', toolInput: { timeFilter: 'today' },
      results: results.slice(0, 1), locale: 'es', totalMatches, shownMatches })
    const alternative = suggestions.find(suggestion => suggestion.id === 'show-alternatives')
    expect(!!alternative).toBe(offers)
    if (offers) expect(alternative?.prompt).toBe('muéstrame algunas opciones alternativas')
  })
  it.each([
    ['en', ['tonight', 'this weekend', 'free only', 'in Palermo']],
    ['es', ['esta noche', 'este fin de semana', 'solo gratis', 'en Palermo']],
  ] as const)('uses concise %s contextual refinements', (locale, expectedPrompts) => {
    const originalQuery = locale === 'es' ? 'música en vivo' : 'live music tonight'
    const suggestions = generateSuggestions({
      originalQuery,
      toolInput: { query: originalQuery },
      results,
      locale,
    })

    expect(suggestions.map(suggestion => suggestion.prompt)).toEqual(expectedPrompts)
    expect(suggestions.every(suggestion => !suggestion.prompt.includes(originalQuery))).toBe(true)
  })
})
