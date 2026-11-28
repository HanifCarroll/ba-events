/** Discovery URLs pin their language without changing the visitor's language preference. */
export function discoveryLocale(pathname: string): 'es' | 'en' | undefined {
  return pathname.startsWith('/agenda/') || pathname.startsWith('/lugares/') ? 'es' : undefined
}
