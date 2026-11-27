/** Discovery URLs pin their language without changing the visitor's language preference. */
export function discoveryLocale(pathname: string): 'en' | 'es' | undefined {
  if (pathname.startsWith('/en/')) return 'en'
  if (pathname.startsWith('/agenda/') || pathname.startsWith('/lugares/') || pathname === '/que-es-ba-eventos') return 'es'
  return undefined
}
