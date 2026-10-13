import { Schema } from 'effect'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'

const schema = Schema.Struct({
	requestId: Schema.String,
	text: Schema.String,
	framing: Schema.NullOr(Schema.Struct({ acknowledgement: Schema.String, nextStep: Schema.String })),
	reasons: Schema.Array(Schema.NullOr(Schema.String)),
})

export function progressText(response: CanonicalChatResponse) {
	return { requestId: response.requestId, text: response.text, framing: response.framing ?? null,
		reasons: response.events.map((event) => event.recommendation_reason ?? null) }
}

/** Text changes cannot introduce, reorder, or replace server-validated artifacts. */
export function applyProgressText(response: CanonicalChatResponse, input: unknown): CanonicalChatResponse | null {
	const result = Schema.decodeUnknownResult(schema)(input)
	if (result._tag !== 'Success' || result.success.requestId !== response.requestId ||
		result.success.reasons.length !== response.events.length) return null
	const value = result.success
	return { ...response, text: value.text, framing: value.framing ?? undefined,
		events: response.events.map((event, index) => ({ ...event, recommendation_reason: value.reasons[index] ?? undefined })) }
}

export function progressArtifactKey(response: CanonicalChatResponse): string {
	return JSON.stringify({ ...response, text: '', framing: undefined,
		events: response.events.map(({ recommendation_reason: _reason, ...event }) => event) })
}
