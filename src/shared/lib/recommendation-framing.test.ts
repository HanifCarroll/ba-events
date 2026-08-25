import { describe, expect, it } from 'vitest'
import type { CanonicalChatEventPayload } from './types.ts'
import { extractRecommendationFraming } from './recommendation-framing.ts'

const events = [{ name: 'Tango Nights', venue_name: 'Club Sur' }] as CanonicalChatEventPayload[]

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

  it.each([
    'ACK: one\nACK: two\nNEXT: question',
    'ACK: one\nNEXT: question\nextra text',
    'ACK: one\nNEXT: https://baeventos.com/events/1',
    'ACK: one\nNEXT: - details or directions',
    'ACK: Tango Nights could be fun\nNEXT: question',
    `ACK: ${'x'.repeat(241)}\nNEXT: question`,
  ])('rejects malformed or untrusted framing: %s', (text) => {
    expect(extractRecommendationFraming(text, events)).toBeNull()
  })
})
