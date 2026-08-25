import { z } from 'zod'

const telegramId = z.number().int().safe().nonnegative().transform(String)
const callbackData = z
  .string()
  .max(64)
  .refine((value) => new TextEncoder().encode(value).length <= 64)
  .regex(/^(?:consent:v1:(?:accept|decline)|prompt:v1:(?:chill|weekend|free|live))$/)

const user = z.object({
  id: telegramId,
  is_bot: z.literal(false),
  language_code: z.string().max(35).optional(),
})

const privateChat = z.object({ id: telegramId, type: z.literal('private') })

const message = z.object({
  message_id: telegramId,
  from: user,
  chat: privateChat,
  date: z.number().int().nonnegative(),
  text: z.string().min(1).max(4096),
})

const callbackMessage = z.object({
  message_id: telegramId,
  chat: privateChat,
})

export const telegramUpdateSchema = z.union([
  z.object({ update_id: telegramId, message }),
  z.object({
    update_id: telegramId,
    callback_query: z.object({
      id: z.string().min(1).max(128),
      from: user,
      message: callbackMessage,
      data: callbackData,
    }),
  }),
])

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>
export type TelegramCommand = 'start' | 'help' | 'new' | 'privacy' | 'delete'
export type ParsedTelegramText =
  | { kind: 'command'; command: TelegramCommand; payload?: string }
  | { kind: 'text'; text: string }

const BOT_SUFFIX = '(?:@[A-Za-z0-9_]{5,32})?'
const START_COMMAND = new RegExp(`^/start${BOT_SUFFIX}(?: ([A-Za-z0-9_-]{1,64}))?$`)
const COMMAND = new RegExp(`^/(help|new|privacy|delete)${BOT_SUFFIX}$`)

export function parseTelegramUpdate(input: unknown): TelegramUpdate | null {
  const parsed = telegramUpdateSchema.safeParse(input)
  return parsed.success ? parsed.data : null
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
