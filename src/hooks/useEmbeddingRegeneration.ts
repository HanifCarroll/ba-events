import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { regenerateEmbeddingsAction } from '@/lib/admin'
import { queryKeys } from '@/lib/query'
import type { EventWithVenue } from '@/lib/types'

export function useEmbeddingRegeneration() {
  const queryClient = useQueryClient()
  const [isRegenerating, setIsRegenerating] = useState(false)

  /**
   * Regenerate embeddings for selected events
   */
  const regenerateEmbeddings = useCallback(
    async (
      events: EventWithVenue[],
      selectedIds: Set<string>,
      onComplete?: () => void
    ) => {
      const selectedEvents = events.filter((e) => selectedIds.has(e.id))

      if (selectedEvents.length === 0) {
        toast.error('No events selected')
        return
      }

      setIsRegenerating(true)
      const toastId = toast.loading(
        `Regenerating embeddings for ${selectedEvents.length} events...`
      )

      try {
        const result = await regenerateEmbeddingsAction({
          data: { eventIds: selectedEvents.map((e) => e.id) },
        })

        if (result.errors && result.errors.length > 0) {
          toast.warning(
            `Regenerated ${result.regenerated}/${result.total} embeddings (${result.errors.length} errors)`,
            { id: toastId }
          )
        } else {
          toast.success(
            `Regenerated embeddings for ${result.regenerated} events`,
            { id: toastId }
          )
        }

        // Invalidate events cache to refresh data
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
        onComplete?.()
      } catch (error) {
        console.error('Embedding regeneration failed:', error)
        toast.error('Failed to regenerate embeddings', { id: toastId })
      } finally {
        setIsRegenerating(false)
      }
    },
    [queryClient]
  )

  return {
    isRegenerating,
    regenerateEmbeddings,
  }
}

export type UseEmbeddingRegenerationReturn = ReturnType<typeof useEmbeddingRegeneration>
