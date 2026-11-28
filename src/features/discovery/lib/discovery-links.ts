export const dateLinks = [
  { label: 'Hoy', href: '/agenda/hoy' },
  { label: 'Este finde', href: '/agenda/fin-de-semana' },
  { label: 'Esta semana', href: '/agenda/esta-semana' },
  { label: 'Gratis', href: '/agenda/gratis' },
]

export const topicLinks = [
  { label: 'Teatro', href: '/agenda/teatro' },
  { label: 'Música en vivo', href: '/agenda/musica-en-vivo' },
  { label: 'Ferias', href: '/agenda/ferias' },
  { label: 'Muestras', href: '/agenda/muestras' },
  { label: 'Poesía', href: '/agenda/poesia' },
  { label: 'Tango', href: '/agenda/tango' },
]

export const footerGroups = [
  { heading: 'Agenda', links: [...dateLinks, ...topicLinks, { label: 'Por barrio', href: '/agenda/barrios' }] },
  { heading: 'BA Eventos', links: [
    { label: 'Qué es BA Eventos', href: '/que-es-ba-eventos' },
    { label: 'Conectá tu asistente de IA', href: '/mcp' },
    { label: 'Privacidad', href: '/privacy' },
  ] },
  { heading: 'In English', links: [
    { label: 'Things to do this weekend', href: '/en/things-to-do-this-weekend' },
    { label: 'Free events this week', href: '/en/free-events-this-week' },
    { label: 'About BA Eventos', href: '/en/about' },
  ] },
]

const englishDateLinks = [
  { label: 'Today', href: '/agenda/hoy' },
  { label: 'This weekend', href: '/en/things-to-do-this-weekend' },
  { label: 'This week', href: '/agenda/esta-semana' },
  { label: 'Free', href: '/en/free-events-this-week' },
]

export function dateNavigation(language: 'es' | 'en') {
  return language === 'en'
    ? { label: 'Agenda dates', links: englishDateLinks }
    : { label: 'Agenda', links: dateLinks }
}

const translations = [
  ['/agenda/fin-de-semana', '/en/things-to-do-this-weekend'],
  ['/agenda/gratis', '/en/free-events-this-week'],
  ['/que-es-ba-eventos', '/en/about'],
] as const

export function discoveryAlternate(path: string) {
  for (const [es, en] of translations) {
    if (path === es) return { href: en, label: 'In English', language: 'en' }
    if (path === en) return { href: es, label: 'En castellano', language: 'es' }
  }
  return undefined
}
