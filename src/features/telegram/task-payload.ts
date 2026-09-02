import { Schema } from 'effect'

const telegramId = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^\d{1,20}$/, { message: 'Expected a Telegram id' }))
)
const identityHash = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/, { message: 'Expected an identity hash' }))
)
const callbackData = Schema.Literals([
	'consent:v1:accept',
	'consent:v1:decline',
	'prompt:v1:chill',
	'prompt:v1:weekend',
	'prompt:v1:free',
	'prompt:v1:live',
])

const plaintextBaseSchema = Schema.Struct({
	identityHash,
	chatId: telegramId,
	text: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(4096)))),
	languageCode: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(35)))),
	callbackId: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(128)))),
	callbackData: Schema.optional(callbackData),
	rateLimited: Schema.optional(Schema.Boolean),
})

const plaintextSchema = plaintextBaseSchema.pipe(
	Schema.refine((value): value is Schema.Schema.Type<typeof plaintextBaseSchema> => {
		const hasCallback = Boolean(value.callbackId || value.callbackData)
		if (hasCallback) {
			return Boolean(value.callbackId && value.callbackData)
				&& !value.text
				&& Boolean(!value.rateLimited || value.callbackData?.startsWith('prompt:v1:'))
		}
		return Boolean(value.text) !== (value.rateLimited === true)
	}, { message: 'Expected one message, rate-limit response, or valid callback payload' })
)

const taskSchema = Schema.Struct({
	updateId: telegramId,
	queueKey: Schema.String.pipe(
		Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, { message: 'Expected a UUID' }))
	),
	sealedEnvelope: Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(8192))),
})

type SafeParseResult<T> =
	| { success: true; data: T }
	| { success: false; error: Error }

function decode<S extends { readonly Type: unknown }>(schema: S, input: unknown): SafeParseResult<S['Type']> {
	const parsed = Schema.decodeUnknownResult(schema as never, { onExcessProperty: 'error' })(input)
	return parsed._tag === 'Success'
		? { success: true, data: parsed.success as S['Type'] }
		: { success: false, error: new Error('Invalid Telegram payload') }
}

/**
 * Effect Schema is the source of truth. These compatibility methods retain the
 * former `.parse`/`.safeParse` surface for direct schema consumers.
 */
export const telegramPlaintextPayloadSchema = Object.assign(plaintextSchema, {
	safeParse(input: unknown): SafeParseResult<Schema.Schema.Type<typeof plaintextSchema>> {
		return decode(plaintextSchema, input)
	},
	parse(input: unknown): Schema.Schema.Type<typeof plaintextSchema> {
		const result = decode(plaintextSchema, input)
		if (!result.success) throw result.error
		return result.data
	},
})

export const telegramTaskPayloadSchema = Object.assign(taskSchema, {
	safeParse(input: unknown): SafeParseResult<Schema.Schema.Type<typeof taskSchema>> {
		return decode(taskSchema, input)
	},
	parse(input: unknown): Schema.Schema.Type<typeof taskSchema> {
		const result = decode(taskSchema, input)
		if (!result.success) throw result.error
		return result.data
	},
})

export type TelegramPlaintextPayload = Schema.Schema.Type<typeof plaintextSchema>
export type TelegramTaskPayload = Schema.Schema.Type<typeof taskSchema>

export function parseTelegramPlaintextPayload(input: unknown): TelegramPlaintextPayload | null {
	const result = decode(plaintextSchema, input)
	return result.success ? result.data : null
}

export function parseTelegramTaskPayload(input: unknown): TelegramTaskPayload | null {
	const result = decode(taskSchema, input)
	return result.success ? result.data : null
}
