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
