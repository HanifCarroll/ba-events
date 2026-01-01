import { useState, useCallback, useRef } from 'react'

/**
 * Base progress state for streaming operations
 */
export interface StreamingProgressState {
  isProcessing: boolean
  current: number
  total: number
}

/**
 * Configuration for the streaming progress hook
 */
export interface UseStreamingProgressOptions<TProgress, TResult> {
  /**
   * Called when processing starts
   */
  onStart?: () => void

  /**
   * Called for each progress update
   */
  onProgress?: (progress: TProgress) => void

  /**
   * Called when processing completes successfully
   */
  onComplete?: (result: TResult) => void

  /**
   * Called when an error occurs
   */
  onError?: (error: Error) => void

  /**
   * Called when processing is stopped early
   */
  onStop?: (processedCount: number) => void

  /**
   * Extract current count from progress update
   */
  getCurrentFromProgress: (progress: TProgress) => number

  /**
   * Extract total count from progress update
   */
  getTotalFromProgress: (progress: TProgress) => number
}

/**
 * Return type for the useStreamingProgress hook
 */
export interface UseStreamingProgressReturn<TProgress, TResult> {
  /** Current processing state */
  state: StreamingProgressState

  /** Start processing a stream */
  processStream: (
    stream: AsyncIterable<TProgress | TResult>,
    isProgress: (update: TProgress | TResult) => update is TProgress
  ) => Promise<TResult | null>

  /** Stop processing (will stop after current item) */
  stop: () => void

  /** Reset state to initial values */
  reset: () => void

  /** Whether the stop signal has been triggered */
  isStopping: boolean
}

const initialState: StreamingProgressState = {
  isProcessing: false,
  current: 0,
  total: 0,
}

/**
 * Generic hook for handling streaming progress operations.
 *
 * This hook abstracts the common pattern used across:
 * - useBackgroundEnrichment (event description enrichment)
 * - useVenueNominatimEnrichment (venue address lookup)
 * - useEmbeddingRegeneration (embedding regeneration)
 *
 * @example
 * ```tsx
 * const { state, processStream, stop } = useStreamingProgress<ProgressType, ResultType>({
 *   onProgress: (p) => updateToast(p.eventName),
 *   onComplete: (r) => showSuccess(r.count),
 *   onError: (e) => showError(e.message),
 *   getCurrentFromProgress: (p) => p.current,
 *   getTotalFromProgress: (p) => p.total,
 * })
 *
 * const result = await processStream(
 *   serverAction({ data }),
 *   (update): update is ProgressType => update.type === 'progress'
 * )
 * ```
 */
export function useStreamingProgress<TProgress, TResult>(
  options: UseStreamingProgressOptions<TProgress, TResult>
): UseStreamingProgressReturn<TProgress, TResult> {
  const {
    onStart,
    onProgress,
    onComplete,
    onError,
    onStop,
    getCurrentFromProgress,
    getTotalFromProgress,
  } = options

  const [state, setState] = useState<StreamingProgressState>(initialState)
  const shouldStopRef = useRef(false)
  const [isStopping, setIsStopping] = useState(false)

  const stop = useCallback(() => {
    shouldStopRef.current = true
    setIsStopping(true)
  }, [])

  const reset = useCallback(() => {
    setState(initialState)
    shouldStopRef.current = false
    setIsStopping(false)
  }, [])

  const processStream = useCallback(
    async (
      stream: AsyncIterable<TProgress | TResult>,
      isProgress: (update: TProgress | TResult) => update is TProgress
    ): Promise<TResult | null> => {
      // Reset stop signal
      shouldStopRef.current = false
      setIsStopping(false)

      setState({
        isProcessing: true,
        current: 0,
        total: 0,
      })

      onStart?.()

      let processedCount = 0
      let wasStopped = false
      let finalResult: TResult | null = null

      try {
        for await (const update of stream) {
          // Check if stopped
          if (shouldStopRef.current) {
            wasStopped = true
            break
          }

          if (isProgress(update)) {
            const current = getCurrentFromProgress(update)
            const total = getTotalFromProgress(update)

            setState({
              isProcessing: true,
              current,
              total,
            })

            processedCount = current
            onProgress?.(update)
          } else {
            // This is the completion result
            finalResult = update
          }
        }

        if (wasStopped) {
          onStop?.(processedCount)
        } else if (finalResult) {
          onComplete?.(finalResult)
        }

        return finalResult
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
        throw err
      } finally {
        setState(initialState)
        shouldStopRef.current = false
        setIsStopping(false)
      }
    },
    [onStart, onProgress, onComplete, onError, onStop, getCurrentFromProgress, getTotalFromProgress]
  )

  return {
    state,
    processStream,
    stop,
    reset,
    isStopping,
  }
}

export type { StreamingProgressState as ProgressState }
