import { expect, it } from 'vitest'
import { statedEventCredits } from './event-credits.ts'

it('keeps only source-quoted names and URLs, separately from facets', () => {
  const descriptions = ['Organiza Colectivo Nube. Actúa Trío Sol (https://example.com/trio).']
  expect(statedEventCredits({
    organizer: { name: 'Colectivo Nube', url: 'https://example.com/invented', excerpt: 'Organiza Colectivo Nube.' },
    performers: [{ name: 'Trío Sol', url: 'https://example.com/trio', excerpt: 'Actúa Trío Sol (https://example.com/trio).' },
      { name: 'Persona inventada', excerpt: 'Actúa Persona inventada.' }],
  }, descriptions)).toEqual({ organizer: { name: 'Colectivo Nube' }, performers: [{ name: 'Trío Sol', url: 'https://example.com/trio' }] })
  expect(statedEventCredits({ organizer: null, performers: [] }, descriptions)).toEqual({})
})

it('checks verbatim citations, whole names, and exact seller identities without reinterpreting the role', () => {
  const excerpt = '🎭 A cargo de Pássline Sur, con Luz y Sómbrá y Trío Bruma.'
  const organizer = { name: 'Passline Sur', excerpt }
  const performers = [
    { name: 'LUZ Y SOMBRA', excerpt },
    { name: 'Brum', excerpt },
    { name: 'Pássline', excerpt },
    { name: 'Trío Bruma', excerpt: 'con Luz y Sómbrá y Trío Bruma!' },
    { name: 'Venti.live', excerpt: 'Invitados: Venti.live' },
  ]
  expect(statedEventCredits({ organizer, performers }, [`${excerpt}\nInvitados: Venti.live`]))
    .toEqual({ organizer: { name: 'Passline Sur' }, performers: [{ name: 'LUZ Y SOMBRA' }] })
})

it('excludes seller display names even when punctuation or spaces differ', () => {
  const excerpt = 'Organiza Alternativa Teatral. Actúa Tú–Entrada.'
  expect(statedEventCredits({ organizer: { name: 'Alternativa Teatral', excerpt },
    performers: [{ name: 'Tú–Entrada', excerpt }] }, [excerpt])).toEqual({})
})

it('accepts a verbatim enrichment credit with different source whitespace', () => {
  const organizer = { name: 'Colectivo Nube', excerpt: 'Presenta Colectivo Nube.' }
  const performers = [{ name: 'Luz y Sombra', excerpt: 'Actúa Luz y Sombra.' }]
  expect(statedEventCredits({ organizer, performers }, ['Presenta\nColectivo\u00a0Nube. Actúa Luz y\t Sombra.']))
    .toEqual({ organizer: { name: 'Colectivo Nube' }, performers: [{ name: 'Luz y Sombra' }] })
})
