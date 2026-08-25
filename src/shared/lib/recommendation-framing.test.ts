import { describe, expect, it } from 'vitest'
import { extractRecommendationFraming, extractRecommendationReasons, extractRecommendationResponse, removeFramingMarkers } from './recommendation-framing.ts'

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

  it('maps exact ordinal reasons to returned event order', () => {
    const response = extractRecommendationResponse(
      'ACK: These fit your plan.\n\nREASON_1: A relaxed option for your music interest.\n\nREASON_2: A hands-on option for your weekend plan.\n\nNEXT: Want details?',
      [{ name: 'First' }, { name: 'Second' }],
    )
    expect(response?.reasons).toEqual([
      'A relaxed option for your music interest.',
      'A hands-on option for your weekend plan.',
    ])
  })

  it.each([
    'ACK: These fit your plan.\nNEXT: Want details?\nREASON_1: First fit.\nREASON_3: Wrong key.',
    'ACK: These fit your plan.\nNEXT: Want details?\nREASON_1: First fit.',
    'ACK: These fit your plan.\nNEXT: Want details?\nREASON_1: https://example.com\nREASON_2: Second fit.',
  ])('rejects malformed or cardinality-mismatched reasons: %s', (text) => {
    expect(extractRecommendationResponse(text, [{ name: 'First' }, { name: 'Second' }])).toBeNull()
  })

  it('parses a single-pick reason without accepting prose', () => {
    expect(extractRecommendationReasons('REASON_1: This fits your 18-year-old sister’s creative interests.', [{ name: 'Event' }])).toEqual([
      'This fits your 18-year-old sister’s creative interests.',
    ])
    expect(extractRecommendationReasons('This fits your request.', [{ name: 'Event' }])).toBeNull()
  })

  it('shortens a long structured reason at a word boundary', () => {
    const reason = extractRecommendationReasons(`REASON_1: ${'hands-on creative workshop '.repeat(8)}`, [{ name: 'Event' }])?.[0]
    expect(reason?.length).toBeLessThanOrEqual(180)
    expect(reason?.endsWith('…')).toBe(true)
    expect(reason).not.toContain('worksh…')
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
