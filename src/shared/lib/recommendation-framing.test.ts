import { describe, expect, it } from 'vitest'
import { extractRecommendationFraming, removeFramingMarkers } from './recommendation-framing.ts'

const events = [{ name: 'Tango Nights', venue_name: 'Club Sur' }]

describe('recommendation framing contract', () => {
  it.each([
    ['en', 'ACK: I found a few options for your night out.\nNEXT: Want help with details or directions?'],
    ['es', 'ACK: Encontré algunas opciones para vos.\nNEXT: ¿Querés que te ayude con detalles o indicaciones?'],
  ])('extracts %s framing', (_locale, text) => {
    expect(extractRecommendationFraming(text, events)).toEqual({
      acknowledgement: text.split('\n')[0].slice(5),
      nextStep: text.split('\n')[1].slice(6),
    })
  })

  it('removes only a complete marker envelope', () => {
    expect(removeFramingMarkers('ACK: Warm intro\nNEXT: Want details?')).toBe('')
    expect(removeFramingMarkers('Directions are ready.\nNext: open the map.')).toBe('Directions are ready.\nNext: open the map.')
  })

  it.each([
    'ACK: one\nACK: two\nNEXT: question',
    'ACK: one\nNEXT: question\nextra text',
    'ACK: one\nNEXT: https://baeventos.com/events/1',
    'ACK: one\nNEXT: - details or directions',
    'ACK: Event starts at 8\nNEXT: question',
    'ACK: one\nNEXT: ARS $5000',
    'ACK: Tango Nights could be fun\nNEXT: question',
    `ACK: ${'x'.repeat(241)}\nNEXT: question`,
  ])('rejects malformed or untrusted framing: %s', (text) => {
    expect(extractRecommendationFraming(text, events)).toBeNull()
  })
})
