import { z } from 'zod'

const telegramId = z.number().int().safe().nonnegative().transform(String)
const callbackData = z
  .string()
  .max(64)
  .refine((value) => new TextEncoder().encode(value).length <= 64)
  .regex(/^consent:v1:(accept|decline)$/)

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
  | { kind: 'command'; command: TelegramCommand }
  | { kind: 'text'; text: string }

const COMMAND = /^\/(start|help|new|privacy|delete)(?:@[A-Za-z0-9_]{5,32})?$/

export function parseTelegramUpdate(input: unknown): TelegramUpdate | null {
  const parsed = telegramUpdateSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function parseTelegramText(input: string): ParsedTelegramText | null {
  const text = input.trim()
  if (!text) return null
  const match = COMMAND.exec(text)
  if (match) return { kind: 'command', command: match[1] as TelegramCommand }
  return text.startsWith('/') ? null : { kind: 'text', text }
}

export function parseConsentCallback(data: string): 'accept' | 'decline' | null {
  const match = /^consent:v1:(accept|decline)$/.exec(data)
  return (match?.[1] as 'accept' | 'decline' | undefined) ?? null
}
