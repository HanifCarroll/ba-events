import { describe, expect, it } from 'vitest'
import type { EventWithVenue } from '#shared/lib/types.ts'
import { generateSuggestions } from './suggestions.ts'

const results = [{
  categories: [],
  is_free: false,
  venue_neighborhood: 'Palermo',
}, {
  categories: [],
  is_free: false,
  venue_neighborhood: 'Palermo',
}] as unknown as EventWithVenue[]

describe('generateSuggestions', () => {
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
