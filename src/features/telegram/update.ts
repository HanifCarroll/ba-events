import { Schema } from 'effect'

const telegramId = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(0, { message: 'Expected a non-negative Telegram id' }))
)
const callbackData = Schema.String.pipe(
	Schema.check(Schema.isMaxLength(64)),
	Schema.check(Schema.isPattern(/^(?:consent:v1:(?:accept|decline)|prompt:v1:(?:chill|weekend|free|live))$/))
)

const user = Schema.Struct({
	id: telegramId,
	is_bot: Schema.Literal(false),
	language_code: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(35)))),
})

const privateChat = Schema.Struct({ id: telegramId, type: Schema.Literal('private') })

const message = Schema.Struct({
	message_id: telegramId,
	from: user,
	chat: privateChat,
	date: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
	text: Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(4096))),
})

const callbackMessage = Schema.Struct({
	message_id: telegramId,
	chat: privateChat,
})

const rawTelegramUpdateSchema = Schema.Union([
	Schema.Struct({ update_id: telegramId, message }),
	Schema.Struct({
		update_id: telegramId,
		callback_query: Schema.Struct({
			id: Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(128))),
			from: user,
			message: callbackMessage,
			data: callbackData,
		}),
	}),
])

export const telegramUpdateSchema = rawTelegramUpdateSchema

type RawTelegramUpdate = Schema.Schema.Type<typeof rawTelegramUpdateSchema>
export type TelegramUpdate = {
	update_id: string
	message: {
		message_id: string
		from: { id: string; is_bot: false; language_code?: string }
		chat: { id: string; type: 'private' }
		date: number
		text: string
	}
} | {
	update_id: string
	callback_query: {
		id: string
		from: { id: string; is_bot: false; language_code?: string }
		message: { message_id: string; chat: { id: string; type: 'private' } }
		data: string
	}
}

export type TelegramCommand = 'start' | 'help' | 'new' | 'privacy' | 'delete'
export type ParsedTelegramText =
	| { kind: 'command'; command: TelegramCommand; payload?: string }
	| { kind: 'text'; text: string }

const BOT_SUFFIX = '(?:@[A-Za-z0-9_]{5,32})?'
const START_COMMAND = new RegExp(`^/start${BOT_SUFFIX}(?: ([A-Za-z0-9_-]{1,64}))?$`)
const COMMAND = new RegExp(`^/(help|new|privacy|delete)${BOT_SUFFIX}$`)

type RawTelegramUser = { id: number; is_bot: false; language_code?: string }

function mapUser(value: RawTelegramUser) {
	return {
		id: String(value.id),
		is_bot: false as const,
		...(value.language_code === undefined ? {} : { language_code: value.language_code }),
	}
}

function mapUpdate(value: RawTelegramUpdate): TelegramUpdate {
	if ('message' in value) {
		return {
			update_id: String(value.update_id),
			message: {
				message_id: String(value.message.message_id),
				from: mapUser(value.message.from),
				chat: { id: String(value.message.chat.id), type: 'private' },
				date: value.message.date,
				text: value.message.text,
			},
		}
	}
	return {
		update_id: String(value.update_id),
		callback_query: {
			id: value.callback_query.id,
			from: mapUser(value.callback_query.from),
			message: {
				message_id: String(value.callback_query.message.message_id),
				chat: { id: String(value.callback_query.message.chat.id), type: 'private' },
			},
			data: value.callback_query.data,
		},
	}
}

export function parseTelegramUpdate(input: unknown): TelegramUpdate | null {
	const parsed = Schema.decodeUnknownResult(rawTelegramUpdateSchema)(input)
	return parsed._tag === 'Success' ? mapUpdate(parsed.success) : null
}

export function parseTelegramText(input: string): ParsedTelegramText | null {
	const text = input.trim()
	if (!text) return null
	const start = START_COMMAND.exec(text)
	if (start) {
		return start[1]
			? { kind: 'command', command: 'start', payload: start[1] }
			: { kind: 'command', command: 'start' }
	}
	const command = COMMAND.exec(text)
	if (command) return { kind: 'command', command: command[1] as TelegramCommand }
	return text.startsWith('/') ? null : { kind: 'text', text }
}

export function parseConsentCallback(data: string): 'accept' | 'decline' | null {
	const match = /^consent:v1:(accept|decline)$/.exec(data)
	return (match?.[1] as 'accept' | 'decline' | undefined) ?? null
}

export type TelegramPromptKey = 'chill' | 'weekend' | 'free' | 'live'

export function parsePromptCallback(data: string): TelegramPromptKey | null {
	const match = /^prompt:v1:(chill|weekend|free|live)$/.exec(data)
	return (match?.[1] as TelegramPromptKey | undefined) ?? null
}
