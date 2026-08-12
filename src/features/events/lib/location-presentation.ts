function normalizeLocationText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Hide a separate address row when the source used the street address as the
 * venue name. The stored source fields remain unchanged.
 */
export function getDistinctVenueAddress(
  venueName: string | null,
  venueAddress: string | null,
): string | null {
  if (!venueAddress) return null
  if (!venueName) return venueAddress

  return normalizeLocationText(venueName) === normalizeLocationText(venueAddress)
    ? null
    : venueAddress
}
