import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useStreamingProgress } from '@/shared/hooks/useStreamingProgress'
import {
  regenerateEmbeddingsAction,
  type EmbeddingComplete,
} from '../api/enrichment'
import type { EmbeddingProgress } from '../api/streaming-types'
import { queryKeys } from '@/shared/lib/query'
import type { EventWithVenue } from '@/shared/lib/types'

export function useEmbeddingRegeneration() {
  const queryClient = useQueryClient()
  const toastIdRef = useRef<string | number | undefined>(undefined)

  const { state, processStream } = useStreamingProgress<
    EmbeddingProgress,
    EmbeddingComplete
  >({
    onProgress: (update) => {
      toast.loading(
        `Regenerating ${update.current}/${update.total}: ${update.eventName.substring(0, 40)}...`,
        {
          id: toastIdRef.current,
          description: update.success
            ? 'Generated embedding'
            : update.error || 'Processing...',
        }
      )
    },
    onComplete: (result) => {
      if (result.errors && result.errors.length > 0) {
        toast.warning(
          `Regenerated ${result.regenerated}/${result.total} embeddings`,
          {
            id: toastIdRef.current,
            description: `${result.errors.length} errors occurred`,
          }
        )
      } else {
        toast.success(
          `Regenerated embeddings for ${result.regenerated} events`,
          { id: toastIdRef.current }
        )
      }

      // Invalidate events cache to refresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
    },
    onError: (error) => {
      console.error('Embedding regeneration failed:', error)
      toast.error('Failed to regenerate embeddings', {
        id: toastIdRef.current,
        description: error.message || 'An unexpected error occurred.',
      })
    },
    getCurrentFromProgress: (p) => p.current,
    getTotalFromProgress: (p) => p.total,
  })

  /**
   * Regenerate embeddings for selected events
   * Uses streaming to show real-time progress updates
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

      toastIdRef.current = toast.loading(
        `Regenerating embeddings 0/${selectedEvents.length}...`
      )

      try {
        const stream = await regenerateEmbeddingsAction({
          data: { eventIds: selectedEvents.map((e) => e.id) },
        })

        await processStream(
          stream,
          (update): update is EmbeddingProgress => update.type === 'progress'
        )

        onComplete?.()
      } finally {
        toastIdRef.current = undefined
      }
    },
    [processStream]
  )

  return {
    isRegenerating: state.isProcessing,
    regenerationProgress: {
      isRegenerating: state.isProcessing,
      current: state.current,
      total: state.total,
    },
    regenerateEmbeddings,
  }
}

export type UseEmbeddingRegenerationReturn = ReturnType<typeof useEmbeddingRegeneration>
