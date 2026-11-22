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
    { name: 'Trío Bruma', excerpt: 'con Luz y Sómbrá y Trío  Bruma.' },
    { name: 'Venti.live', excerpt: 'Invitados: Venti.live' },
  ]
  expect(statedEventCredits({ organizer, performers }, [`${excerpt}\nInvitados: Venti.live`]))
    .toEqual({ organizer: { name: 'Passline Sur' }, performers: [{ name: 'LUZ Y SOMBRA' }] })
})
