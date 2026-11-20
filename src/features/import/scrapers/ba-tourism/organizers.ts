const DEFAULT_ORGANIZER = 'Ente de Turismo del Gobierno de la Ciudad de Buenos Aires'

/** Read credits from the generated agenda JSON-LD, not the site's fallback or event button URL. */
export function baTourismOrganizerNames(script: string): ReadonlyMap<string, string> {
  const names = new Map<string, Set<string | null>>()
  let entries: unknown
  try { entries = JSON.parse(script) } catch { return new Map() }
  if (!Array.isArray(entries)) return new Map()
  for (const entry of entries) {
    if (entry?.['@type'] !== 'Event' || typeof entry.name !== 'string') continue
    const title = entry.name.trim()
    const name = typeof entry.organizer?.name === 'string' ? entry.organizer.name.trim() : ''
    const credits = names.get(title) ?? new Set()
    credits.add(name && name !== DEFAULT_ORGANIZER ? name : null)
    names.set(title, credits)
  }
  const credited = new Map<string, string>()
  for (const [title, credits] of names) {
    const [name] = credits
    if (credits.size === 1 && name) credited.set(title, name)
  }
  return credited
}
