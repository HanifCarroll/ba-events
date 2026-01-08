/**
 * Neighborhood Mapping Utilities
 *
 * Pure functions for mapping scraped neighborhood strings to valid Neighborhood types.
 * This file has no TanStack Start dependencies so it can be imported by Trigger.dev jobs.
 */
import type { Neighborhood } from '@/shared/lib/types'
import { NEIGHBORHOODS } from '@/shared/lib/types'

/**
 * Map scraped neighborhood string to valid Neighborhood type
 * Handles exact matches, partial matches, and common aliases
 */
export function mapToNeighborhood(scraped: string | null | undefined): Neighborhood | null {
  if (!scraped) return null

  const normalized = scraped.trim()

  // Exact match (case-insensitive)
  const exactMatch = NEIGHBORHOODS.find(
    (n) => n.toLowerCase() === normalized.toLowerCase()
  )
  if (exactMatch) return exactMatch

  // Partial match (neighborhood contains scraped or vice versa)
  const partialMatch = NEIGHBORHOODS.find(
    (n) =>
      n.toLowerCase().includes(normalized.toLowerCase()) ||
      normalized.toLowerCase().includes(n.toLowerCase())
  )
  if (partialMatch) return partialMatch

  // Common aliases
  const aliases: Record<string, Neighborhood> = {
    microcentro: 'San Nicolás',
    centro: 'San Nicolás',
    congreso: 'Balvanera',
    once: 'Balvanera',
    abasto: 'Balvanera',
    tribunales: 'San Nicolás',
    'barrio norte': 'Recoleta',
    'cañitas': 'Palermo',
    'las cañitas': 'Palermo',
    soho: 'Palermo',
    'palermo soho': 'Palermo',
    hollywood: 'Palermo',
    'palermo hollywood': 'Palermo',
    botanico: 'Palermo',
    'puerto de frutos': 'Puerto Madero',
  }

  const aliasMatch = aliases[normalized.toLowerCase()]
  if (aliasMatch) return aliasMatch

  return null
}
