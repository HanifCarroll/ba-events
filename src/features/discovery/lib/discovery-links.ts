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

export const footerGroups = [{ heading: 'Agenda', links: [...dateLinks, ...topicLinks] }]
