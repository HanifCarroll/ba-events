import { useState, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { regenerateEmbeddingsAction } from '@/lib/admin'
import type { EmbeddingComplete } from '@/lib/admin/enrichment'
import { queryKeys } from '@/lib/query'
import type { EventWithVenue } from '@/lib/types'

interface RegenerationState {
  isRegenerating: boolean
  current: number
  total: number
}

export function useEmbeddingRegeneration() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<RegenerationState>({
    isRegenerating: false,
    current: 0,
    total: 0,
  })
  const toastIdRef = useRef<string | number | undefined>(undefined)

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

      setState({
        isRegenerating: true,
        current: 0,
        total: selectedEvents.length,
      })

      toastIdRef.current = toast.loading(
        `Regenerating embeddings 0/${selectedEvents.length}...`
      )

      try {
        const stream = await regenerateEmbeddingsAction({
          data: { eventIds: selectedEvents.map((e) => e.id) },
        })

        let finalResult: EmbeddingComplete | null = null

        for await (const update of stream) {
          if (update.type === 'progress') {
            setState({
              isRegenerating: true,
              current: update.current,
              total: update.total,
            })

            toast.loading(
              `Regenerating ${update.current}/${update.total}: ${update.eventName.substring(0, 40)}...`,
              {
                id: toastIdRef.current,
                description: update.success
                  ? 'Generated embedding'
                  : update.error || 'Processing...',
              }
            )
          } else if (update.type === 'complete') {
            finalResult = update
          }
        }

        if (finalResult) {
          if (finalResult.errors && finalResult.errors.length > 0) {
            toast.warning(
              `Regenerated ${finalResult.regenerated}/${finalResult.total} embeddings`,
              {
                id: toastIdRef.current,
                description: `${finalResult.errors.length} errors occurred`,
              }
            )
          } else {
            toast.success(
              `Regenerated embeddings for ${finalResult.regenerated} events`,
              { id: toastIdRef.current }
            )
          }
        }

        // Invalidate events cache to refresh data
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
        onComplete?.()
      } catch (error) {
        console.error('Embedding regeneration failed:', error)
        toast.error('Failed to regenerate embeddings', {
          id: toastIdRef.current,
          description:
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred.',
        })
      } finally {
        setState({ isRegenerating: false, current: 0, total: 0 })
        toastIdRef.current = undefined
      }
    },
    [queryClient]
  )

  return {
    isRegenerating: state.isRegenerating,
    regenerationProgress: state,
    regenerateEmbeddings,
  }
}

export type UseEmbeddingRegenerationReturn = ReturnType<typeof useEmbeddingRegeneration>
