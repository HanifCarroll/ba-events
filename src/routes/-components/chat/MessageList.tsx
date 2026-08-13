import { useCallback, useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { ChatMessage } from './ChatMessage'
import type { ChatMessage as ChatMessageType } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'

type LoadingPhase =
  | 'idle'
  | 'preparing'
  | 'thinking'
  | 'running_tool'
  | 'composing'
  | 'persisting'
  | 'error'

interface MessageListProps {
  messages: ChatMessageType[]
  isLoading?: boolean
  loadingPhase?: LoadingPhase
  loadingLabel?: string
  onSuggestionSelect?: (prompt: string) => void
}

/**
 * How far below the top of the scroll viewport the start of a finished
 * assistant response should land.
 */
const ASSISTANT_RESPONSE_TOP_PADDING = 24

interface ScrollGeometry {
  getBoundingClientRect: () => Pick<DOMRect, 'top'>
  scrollTop: number
  scrollTo: (options: ScrollToOptions) => void
}

/**
 * Scrolls `container` so the top of `messageElement` sits
 * `ASSISTANT_RESPONSE_TOP_PADDING` px below the container's top edge.
 */
function scrollAssistantToTop(
  container: ScrollGeometry,
  messageElement: Pick<ScrollGeometry, 'getBoundingClientRect'>
): void {
  const isTouchDevice =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  const top =
    messageElement.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop -
    ASSISTANT_RESPONSE_TOP_PADDING
  container.scrollTo({
    top,
    behavior: isTouchDevice ? 'instant' : 'smooth',
  })
}

interface AssistantTopScrollState {
  /** Id of the assistant response to align once the in-flight request completes. */
  pendingScrollAssistantId: string | null
  /** Last assistant message id observed by the previous update. */
  prevLastAssistantId: string | null
}

/**
 * Tracks the assistant response being composed during a request and reports
 * when it completes, so the UI can align the top of the response with the
 * top of the viewport. Pure state machine: `isLoading` is true while a chat
 * request is in flight (submitted/streaming/persisting), false when it ends.
 *
 * - While loading: remembers a NEW assistant message that appears (the
 *   response being composed) and keeps remembering it as it streams.
 * - When loading ends: reports that remembered id for top-alignment, but
 *   only if it is still the last assistant message. Conversation loads and
 *   failed requests (no assistant message) never trigger a scroll.
 */
function updateAssistantTopScroll(
  state: AssistantTopScrollState,
  isLoading: boolean,
  lastAssistantId: string | null
): { state: AssistantTopScrollState; scrollToAssistantId: string | null } {
  const { pendingScrollAssistantId, prevLastAssistantId } = state

  if (isLoading) {
    const nextPending =
      lastAssistantId && lastAssistantId !== prevLastAssistantId
        ? lastAssistantId
        : pendingScrollAssistantId
    return {
      state: { pendingScrollAssistantId: nextPending, prevLastAssistantId: lastAssistantId },
      scrollToAssistantId: null,
    }
  }

  const scrollToAssistantId =
    pendingScrollAssistantId && pendingScrollAssistantId === lastAssistantId
      ? pendingScrollAssistantId
      : null
  return {
    state: { pendingScrollAssistantId: null, prevLastAssistantId: lastAssistantId },
    scrollToAssistantId,
  }
}

export function MessageList({
  messages,
  isLoading = false,
  loadingPhase = 'idle',
  loadingLabel,
  onSuggestionSelect,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevMessageCountRef = useRef(messages.length)
  const prevIsLoadingRef = useRef(false)
  const isUserScrollingRef = useRef(false)
  const assistantTopScrollRef = useRef<AssistantTopScrollState>({
    pendingScrollAssistantId: null,
    prevLastAssistantId: null,
  })

  const scrollToBottom = useCallback((force = false) => {
    if (!bottomRef.current) return
    if (!force && isUserScrollingRef.current) return

    // Use 'instant' on mobile to avoid smooth scroll fighting with touch gestures
    // Detect touch device by checking for touch points or coarse pointer
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    bottomRef.current.scrollIntoView({
      behavior: isTouchDevice ? 'instant' : 'smooth',
      block: 'end',
    })
  }, [])

  // Track when user is manually scrolling to avoid fighting with auto-scroll
  useEffect(() => {
    const container = containerRef.current?.parentElement
    if (!container) return

    let scrollTimeout: ReturnType<typeof setTimeout>

    const handleScroll = () => {
      isUserScrollingRef.current = true
      clearTimeout(scrollTimeout)
      // Reset after scroll settles (500ms matches smooth scroll duration)
      scrollTimeout = setTimeout(() => {
        isUserScrollingRef.current = false
      }, 500)
    }

    // Use passive listener for better scroll performance on mobile
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      clearTimeout(scrollTimeout)
    }
  }, [])

  // Auto-scroll only when a NEW message is added (not during streaming updates)
  // Skip if user is actively scrolling to avoid fighting touch gestures
  useEffect(() => {
    const messageCount = messages.length
    const prevCount = prevMessageCountRef.current

    // Only scroll if message count increased.
    if (messageCount > prevCount) {
      scrollToBottom()
    }

    prevMessageCountRef.current = messageCount
  }, [messages.length, scrollToBottom])

  // Auto-scroll when loading indicator first appears so "Thinking..." stays visible.
  useEffect(() => {
    if (isLoading && !prevIsLoadingRef.current) {
      scrollToBottom(true)
    }

    prevIsLoadingRef.current = isLoading
  }, [isLoading, scrollToBottom])

  // When the in-flight request completes, align the top of the finished
  // assistant response with the top of the viewport (plus a little padding)
  // so the response reads from the start. Skip while the user is scrolling.
  useEffect(() => {
    const lastAssistant =
      [...messages].reverse().find((message) => message.role === 'assistant') ?? null
    const { state, scrollToAssistantId } = updateAssistantTopScroll(
      assistantTopScrollRef.current,
      isLoading,
      lastAssistant?.id ?? null
    )
    assistantTopScrollRef.current = state

    if (!scrollToAssistantId || isUserScrollingRef.current) return

    const container = containerRef.current?.parentElement
    const messageEl = containerRef.current?.querySelector(
      `[data-message-id="${scrollToAssistantId}"]`
    )
    if (!container || !(messageEl instanceof HTMLElement)) return

    scrollAssistantToTop(container, messageEl)
  }, [messages, isLoading])

  return (
    <div ref={containerRef} className="px-4 pt-8 pb-4 sm:px-8 sm:py-12 lg:py-16">
      <div
        className="max-w-[860px] mx-auto"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.map((message, index) => (
          <ChatMessage
            key={message.id}
            message={message}
            onSuggestionSelect={onSuggestionSelect}
            suggestionsDisabled={isLoading}
            isLast={!isLoading && index === messages.length - 1}
          />
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start mb-6 animate-fade-in-up pl-0 sm:pl-10">
            <div className="px-3 py-2">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Sparkles className="h-4 w-4 text-accent animate-pulse-warm" />
                <span className="text-sm tracking-wide" data-phase={loadingPhase}>
                  {loadingLabel ?? m.chat_thinking()}
                </span>
                <span className="flex gap-1">
                  <span className="w-1 h-1 bg-primary/60 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-primary/60 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-primary/60 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
