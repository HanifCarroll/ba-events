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

it('requires a role, stops organizer evidence at the first comma or period, and excludes sellers, sponsors, and after-party DJs', () => {
  const excerpt = 'Organizado por Colectivo Nube, texto que no se debe guardar. Actúa Trío Sol.'
  expect(statedEventCredits({ organizer: { name: 'Colectivo Nube', excerpt } }, [excerpt])).toEqual({ organizer: { name: 'Colectivo Nube' } })
  expect(statedEventCredits({ organizer: { name: 'Colectivo Nube, texto que no se debe guardar', excerpt } }, [excerpt])).toEqual({})
  expect(statedEventCredits({ organizer: { name: 'Passline', excerpt: 'Presenta: Passline.' }, performers: [
    { name: 'Falso', excerpt: 'Auspicia Falso.' }, { name: 'Otro', excerpt: 'DJ: Otro' },
    { name: 'Invitado', excerpt: 'Invitado estuvo en el público.' },
  ] }, ['Presenta: Passline. Auspicia Falso. Invitado estuvo en el público.\nAfter-party\nDJ: Otro'])).toEqual({})
})

it.each(['\n\n', '\n## Show principal\n', '\nShow principal:\n'])('limits the after-party to its own section (%j)', separator => {
  const source = `After-party\nDJ: Uno\nDJ: Dos${separator}DJ: Tres`
  const performers = ['Uno', 'Dos', 'Tres'].map(name => ({ name, excerpt: `DJ: ${name}` }))
  expect(statedEventCredits({ performers }, [source])).toEqual({ performers: [{ name: 'Tres' }] })
})

it.each(['Organizador', 'Organizadora'])('accepts %s and keeps a performer name containing y intact', label => {
  const excerpt = `${label}: Nube. Actúa: Luz y Sombra`
  const organizer = { name: 'Nube', excerpt }
  const performers = ['Luz y Sombra', 'Luz', 'Sombra'].map(name => ({ name, excerpt }))
  expect(statedEventCredits({ organizer, performers }, [excerpt])).toEqual({ organizer: { name: 'Nube' }, performers: [{ name: 'Luz y Sombra' }] })
})
