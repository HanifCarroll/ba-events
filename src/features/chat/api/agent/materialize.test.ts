import { describe, expect, it } from 'vitest'
import {
  materializeText,
  materializeClarificationQuestions,
  materializeClarificationText,
  MESSAGE_KEY_KIND,
} from './materialize.ts'
import { responsePlanSchema } from './finalizer.ts'
import type { MessageKey } from '#shared/lib/types.ts'

describe('materializeText (deterministic server text)', () => {
  it('finalizer schema carries no arbitrary text/prose field', () => {
    const shape = responsePlanSchema.shape as Record<string, unknown>
    expect('text' in shape).toBe(false)
    expect('prose' in shape).toBe(false)
    // The closed plan selects a kind + messageKey + artifact refs only.
    expect(shape.contractVersion).toBeDefined()
    expect(shape.primaryKind).toBeDefined()
    expect(shape.messageKey).toBeDefined()
  })

  it('interpolates only validated names into the three name templates', () => {
    expect(
      materializeText({ messageKey: 'event_details', locale: 'en', eventName: 'Tango night' })
    ).toBe('Here are the details for Tango night.')
    expect(
      materializeText({ messageKey: 'directions', locale: 'en', directionsVenueName: 'Niceto' })
    ).toBe("Here's how to get to Niceto.")
    expect(
      materializeText({ messageKey: 'venue_details', locale: 'es', venueName: 'Niceto' })
    ).toBe('Esto es lo que encontré de Niceto.')
  })

  it('sanitizes interpolated names (control chars, whitespace, length)', () => {
    expect(
      materializeText({ messageKey: 'event_details', locale: 'en', eventName: 'Tango\u0000Night' })
    ).toBe('Here are the details for Tango Night.')
    const bounded = materializeText({
      messageKey: 'event_details',
      locale: 'en',
      eventName: 'x'.repeat(200),
    })
    expect(bounded).toContain('…')
  })

  it('every closed messageKey materializes to a non-empty EN and ES text', () => {
    const keys = Object.keys(MESSAGE_KEY_KIND) as MessageKey[]
    for (const key of keys) {
      expect(materializeText({ messageKey: key, locale: 'en' }).length).toBeGreaterThan(0)
      expect(materializeText({ messageKey: key, locale: 'es' }).length).toBeGreaterThan(0)
    }
  })

  it('materializes bounded clarification labels from fixed keys (EN + ES)', () => {
    expect(materializeClarificationQuestions(['which_day', 'which_time'], 'en')).toEqual([
      { key: 'which_day', label: 'Which day are you interested in?' },
      { key: 'which_time', label: 'What time works for you?' },
    ])
    expect(materializeClarificationQuestions(['which_day'], 'es')).toEqual([
      { key: 'which_day', label: '¿Qué día te interesa?' },
    ])
  })

  it('materializes the clarification text block from labels in order (EN + ES)', () => {
    expect(
      materializeClarificationText([
        { key: 'which_day', label: 'Which day are you interested in?' },
        { key: 'which_time', label: 'What time works for you?' },
      ])
    ).toBe('Which day are you interested in? What time works for you?')
    expect(
      materializeClarificationText([{ key: 'which_category', label: '¿Qué tipo de evento buscás?' }])
    ).toBe('¿Qué tipo de evento buscás?')
  })

  it('share_guidance materializes a localized share-button text (EN + ES)', () => {
    expect(materializeText({ messageKey: 'share_guidance', locale: 'en' })).toContain('share button')
    expect(materializeText({ messageKey: 'share_guidance', locale: 'es' })).toContain(
      'botón de compartir'
    )
  })

  it('only the applied mutation lead claims an update; the rest are truthful', () => {
    expect(materializeText({ messageKey: 'mutation_applied', locale: 'en' })).toBe(
      'Your saved events are updated.'
    )
    expect(materializeText({ messageKey: 'mutation_applied', locale: 'es' })).toBe(
      'Actualicé tus guardados.'
    )
    // Failure/mixed/unauthenticated/not-found leads never claim an update.
    for (const key of [
      'mutation_failed',
      'mutation_mixed',
      'mutation_unauthenticated',
      'mutation_not_found',
    ] as const) {
      const en = materializeText({ messageKey: key, locale: 'en' })
      const es = materializeText({ messageKey: key, locale: 'es' })
      expect(en).not.toContain('updated')
      expect(es).not.toContain('Actualicé')
    }
    expect(materializeText({ messageKey: 'mutation_failed', locale: 'en' })).toBe(
      "Here's what happened."
    )
    expect(materializeText({ messageKey: 'mutation_failed', locale: 'es' })).toBe(
      'Esto fue lo que pasó.'
    )
  })

  it('partial_results and pinned_event_unavailable materialize closed EN + ES text', () => {
    expect(materializeText({ messageKey: 'partial_results', locale: 'en' })).toContain(
      "part of the search didn't complete"
    )
    expect(materializeText({ messageKey: 'partial_results', locale: 'es' })).toContain(
      'una parte de la búsqueda no se pudo completar'
    )
    expect(materializeText({ messageKey: 'pinned_event_unavailable', locale: 'en' }).length).toBeGreaterThan(0)
    expect(materializeText({ messageKey: 'pinned_event_unavailable', locale: 'es' }).length).toBeGreaterThan(0)
  })
})
