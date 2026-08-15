/**
 * Pure scroll-position helpers extracted from the legacy `MessageList` so the
 * completion top-alignment state machine can be tested without a DOM. The
 * component (`MessageList.svelte`) imports these unchanged.
 */

/** How far below the top of the scroll viewport the start of a finished assistant response should land. */
export const ASSISTANT_RESPONSE_TOP_PADDING = 24

export interface ScrollGeometry {
	getBoundingClientRect: () => Pick<DOMRect, 'top'>
	scrollTop: number
	scrollTo: (options: ScrollToOptions) => void
}

/**
 * Scrolls `container` so the top of `messageElement` sits
 * `ASSISTANT_RESPONSE_TOP_PADDING` px below the container's top edge.
 */
export function scrollAssistantToTop(
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
		behavior: isTouchDevice ? 'instant' : 'smooth'
	})
}

export interface AssistantTopScrollState {
	/** Id of the assistant response to align once the in-flight request completes. */
	pendingScrollAssistantId: string | null
	/** Last assistant message id observed by the previous update. */
	prevLastAssistantId: string | null
}

/**
 * Tracks the assistant response being composed during a request and reports
 * when it completes, so the UI can align the top of the response with the top
 * of the viewport. Pure state machine: `isLoading` is true while a chat
 * request is in flight (submitted/streaming/persisting), false when it ends.
 *
 * - While loading: remembers a NEW assistant message that appears (the
 *   response being composed) and keeps remembering it as it streams.
 * - When loading ends: reports that remembered id for top-alignment, but only
 *   if it is still the last assistant message. Conversation loads and failed
 *   requests (no assistant message) never trigger a scroll.
 */
export function updateAssistantTopScroll(
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
			scrollToAssistantId: null
		}
	}

	const scrollToAssistantId =
		pendingScrollAssistantId && pendingScrollAssistantId === lastAssistantId
			? pendingScrollAssistantId
			: null
	return {
		state: { pendingScrollAssistantId: null, prevLastAssistantId: lastAssistantId },
		scrollToAssistantId
	}
}
