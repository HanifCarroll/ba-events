import { z } from 'zod'

const telegramId = z.string().regex(/^\d{1,20}$/)
const identityHash = z.string().regex(/^[a-f0-9]{64}$/)

export const telegramPlaintextPayloadSchema = z
  .object({
    identityHash,
    chatId: telegramId,
    text: z.string().min(1).max(4096).optional(),
    languageCode: z.string().max(35).optional(),
    callbackId: z.string().min(1).max(128).optional(),
    callbackData: z.enum(['consent:v1:accept', 'consent:v1:decline']).optional(),
    rateLimited: z.boolean().optional(),
  })
  .strict()
  .refine((value) => {
    const message = Boolean(value.text || value.rateLimited)
    const callback = Boolean(value.callbackId && value.callbackData)
    return message !== callback && !(value.callbackId || value.callbackData) === message
  }, 'Expected exactly one message or callback payload')

export const telegramTaskPayloadSchema = z
  .object({
    updateId: telegramId,
    queueKey: z.string().uuid(),
    sealedEnvelope: z.string().min(1).max(8192),
  })
  .strict()

export type TelegramPlaintextPayload = z.infer<typeof telegramPlaintextPayloadSchema>
export type TelegramTaskPayload = z.infer<typeof telegramTaskPayloadSchema>
