/**
 * Refinement Suggestions Generator
 *
 * Generates contextual refinement suggestions based on search results.
 * Used to help users refine their event searches.
 */

import type { EventWithVenue, RefinementSuggestion } from '@/shared/lib/types'
import type { SearchEventsInput } from './tools/search-events'

/**
 * Context for generating suggestions
 */
export interface SuggestionContext {
  /** The user's original query */
  originalQuery: string
  /** The tool input that was used for the search */
  toolInput: SearchEventsInput
  /** The search results */
  results: EventWithVenue[]
  /** Current locale */
  locale: 'en' | 'es'
}

/**
 * Generate refinement suggestions based on search context.
 *
 * The suggestions are contextual:
 * - For single recommendations: suggestions help explore alternatives
 * - For multiple results: suggestions help narrow down
 * - For no results: suggestions help pivot to new searches
 */
export function generateSuggestions(context: SuggestionContext): RefinementSuggestion[] {
  const { originalQuery, toolInput, results, locale } = context
  const suggestions: RefinementSuggestion[] = []
  const hasResults = results.length > 0
  const isSingleRecommendation = results.length === 1

  if (hasResults) {
    // CONCIERGE MODE: Single recommendation = contextual refinements based on the event
    if (isSingleRecommendation) {
      const event = results[0]

      // Vibe-based refinements based on event categories
      const isHighEnergy = event.categories.some(c => ['music', 'festival'].includes(c))
      const isChill = event.categories.some(c => ['arts', 'food'].includes(c))

      if (isHighEnergy) {
        suggestions.push({
          id: 'more-chill',
          label: locale === 'es' ? 'Algo más tranquilo' : 'Something more chill',
          prompt: locale === 'es' ? 'algo más tranquilo y relajado' : 'something more chill and relaxed',
          icon: 'moon',
          type: 'broader',
        })
      }
      if (isChill) {
        suggestions.push({
          id: 'more-energy',
          label: locale === 'es' ? 'Más energía' : 'Higher energy',
          prompt: locale === 'es' ? 'algo con más energía y movimiento' : 'something with more energy and dancing',
          icon: 'sparkles',
          type: 'broader',
        })
      }

      // Neighborhood refinement
      if (event.venue_neighborhood) {
        suggestions.push({
          id: 'different-area',
          label: locale === 'es' ? 'Otra zona' : 'Different area',
          prompt: locale === 'es'
            ? `algo similar pero no en ${event.venue_neighborhood}`
            : `something similar but not in ${event.venue_neighborhood}`,
          icon: 'map-pin',
          type: 'neighborhood',
        })
      }

      // Price refinement
      if (event.price && event.price > 5000) {
        suggestions.push({
          id: 'more-budget',
          label: locale === 'es' ? 'Más económico' : 'More budget-friendly',
          prompt: locale === 'es' ? 'algo más económico' : 'something more affordable',
          icon: 'ticket',
          type: 'price',
        })
      } else if (event.is_free) {
        suggestions.push({
          id: 'more-upscale',
          label: locale === 'es' ? 'Más premium' : 'More upscale',
          prompt: locale === 'es' ? 'algo más exclusivo o premium' : 'something more upscale or exclusive',
          icon: 'sparkles',
          type: 'price',
        })
      }

      // Always include "show alternatives"
      suggestions.push({
        id: 'show-alternatives',
        label: locale === 'es' ? 'Ver alternativas' : 'Show alternatives',
        prompt: locale === 'es' ? 'muéstrame algunas opciones alternativas' : 'show me a few alternative options',
        icon: 'list',
        type: 'broader',
      })

    } else {
      // MULTI-RESULT MODE: Standard refinements

      // Time suggestions (if no time filter was used)
      if (!toolInput.timeFilter) {
        suggestions.push({
          id: 'tonight',
          label: locale === 'es' ? 'Esta noche' : 'Tonight',
          prompt: `${originalQuery} tonight`,
          icon: 'moon',
          type: 'time',
        })
        suggestions.push({
          id: 'weekend',
          label: locale === 'es' ? 'Este finde' : 'This weekend',
          prompt: `${originalQuery} this weekend`,
          icon: 'calendar',
          type: 'time',
        })
      }

      // Price suggestion (if results have paid events and not already filtering free)
      const hasPaidEvents = results.some(e => !e.is_free)
      if (hasPaidEvents && !toolInput.isFree) {
        suggestions.push({
          id: 'free',
          label: locale === 'es' ? 'Solo gratis' : 'Free only',
          prompt: `free ${originalQuery}`,
          icon: 'ticket',
          type: 'price',
        })
      }

      // Neighborhood suggestion (from most common in results)
      const neighborhoodCounts = new Map<string, number>()
      results.forEach(e => {
        if (e.venue_neighborhood) {
          neighborhoodCounts.set(e.venue_neighborhood, (neighborhoodCounts.get(e.venue_neighborhood) || 0) + 1)
        }
      })
      if (neighborhoodCounts.size > 0 && !toolInput.neighborhood) {
        const topNeighborhood = [...neighborhoodCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        suggestions.push({
          id: `neighborhood-${topNeighborhood}`,
          label: locale === 'es' ? `En ${topNeighborhood}` : `In ${topNeighborhood}`,
          prompt: `${originalQuery} in ${topNeighborhood}`,
          icon: 'map-pin',
          type: 'neighborhood',
        })
      }
    }
  } else {
    // REPLACE MODE: pivot to new search (escape hatches)
    suggestions.push({
      id: 'tonight',
      label: locale === 'es' ? "¿Qué hay esta noche?" : "What's tonight?",
      prompt: locale === 'es' ? "qué hay esta noche" : "what's happening tonight",
      icon: 'moon',
      type: 'broader',
    })
    suggestions.push({
      id: 'browse-all',
      label: locale === 'es' ? 'Ver todos' : 'Browse all',
      prompt: locale === 'es' ? 'eventos esta semana' : 'events this week',
      icon: 'calendar',
      type: 'broader',
    })

    // Suggest some categories
    const categoriesToSuggest = ['music', 'food', 'arts'] as const
    const categoryLabels: Record<string, { en: string; es: string }> = {
      music: { en: 'Live music', es: 'Música en vivo' },
      food: { en: 'Food & dining', es: 'Gastronomía' },
      arts: { en: 'Arts & culture', es: 'Arte y cultura' },
    }

    for (const cat of categoriesToSuggest.slice(0, 2)) {
      suggestions.push({
        id: `category-${cat}`,
        label: locale === 'es' ? categoryLabels[cat].es : categoryLabels[cat].en,
        prompt: locale === 'es' ? `${categoryLabels[cat].es} esta semana` : `${categoryLabels[cat].en} this week`,
        icon: 'sparkles',
        type: 'category',
      })
    }
  }

  // Return max 4 suggestions
  return suggestions.slice(0, 4)
}
