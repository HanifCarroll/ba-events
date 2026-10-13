import type { CanonicalChatResponse } from '#shared/lib/types.ts'

export interface ResponseFeedbackContext {
	responseId: string
	responseKind: CanonicalChatResponse['kind']
	eventsReturned: number
}

export type Helpfulness = 'helpful' | 'not_helpful'
export interface ResponseFeedbackState { shown: boolean; rating: Helpfulness | null }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
type Entry = ResponseFeedbackState & { responseId: string }
const STORAGE_KEY = 'ba-eventos:response-feedback:v1'
const MAX_ENTRIES = 200

/** Only a final canonical reply whose owning attempt has settled can be rated. */
export function responseFeedbackContext(
	canonical: CanonicalChatResponse | null,
	unsettled: boolean,
): ResponseFeedbackContext | undefined {
	if (!canonical || unsettled) return undefined
	return {
		responseId: canonical.requestId,
		responseKind: canonical.kind,
		eventsReturned: canonical.events.length,
	}
}

function readEntries(storage?: Storage): Entry[] {
	try {
		const value: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
		if (!Array.isArray(value)) return []
		return value.filter((entry): entry is Entry => entry !== null &&
			typeof entry === 'object' && typeof entry.responseId === 'string' &&
			typeof entry.shown === 'boolean' &&
			(entry.rating === null || entry.rating === 'helpful' || entry.rating === 'not_helpful')
		).slice(-MAX_ENTRIES)
	} catch { return [] }
}

/** Session-local selection; analytics queries still deduplicate by response ID. */
export function createResponseFeedback(
	context: ResponseFeedbackContext,
	storage: Storage | undefined,
	emit: (event: 'chat:feedback_shown' | 'chat:helpfulness_rated', properties: Record<string, unknown>) => void,
) {
	const saved = readEntries(storage).find(entry => entry.responseId === context.responseId)
	let state: ResponseFeedbackState = { shown: saved?.shown ?? false, rating: saved?.rating ?? null }
	const properties = {
		response_id: context.responseId,
		response_kind: context.responseKind,
		events_returned: context.eventsReturned,
	}
	function persist() {
		try {
			const other = readEntries(storage).filter(entry => entry.responseId !== context.responseId)
			storage?.setItem(STORAGE_KEY, JSON.stringify([
				...other, { responseId: context.responseId, ...state },
			].slice(-MAX_ENTRIES)))
		} catch { /* A restricted/full browser store must not break the chat. */ }
	}
	function send(event: Parameters<typeof emit>[0], extra: Record<string, unknown> = {}) {
		try { emit(event, { ...properties, ...extra }) } catch { /* Analytics is best effort. */ }
	}
	return {
		get state(): ResponseFeedbackState { return { ...state } },
		show() {
			if (state.shown) return
			state = { ...state, shown: true }
			persist()
			send('chat:feedback_shown')
		},
		rate(rating: Helpfulness) {
			if (rating === state.rating) return
			this.show()
			const previous = state.rating
			state = { ...state, rating }
			persist()
			send('chat:helpfulness_rated', { rating, previous_rating: previous })
		},
	}
}
