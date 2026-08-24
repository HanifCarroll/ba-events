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
    callbackData: z.enum([
      'consent:v1:accept',
      'consent:v1:decline',
      'prompt:v1:chill',
      'prompt:v1:weekend',
      'prompt:v1:free',
      'prompt:v1:live',
    ]).optional(),
    rateLimited: z.boolean().optional(),
  })
  .strict()
  .refine((value) => {
    const hasCallback = Boolean(value.callbackId || value.callbackData)
    if (hasCallback) {
      return Boolean(value.callbackId && value.callbackData)
        && !value.text
        && (!value.rateLimited || value.callbackData?.startsWith('prompt:v1:'))
    }
    return Boolean(value.text) !== (value.rateLimited === true)
  }, 'Expected one message, rate-limit response, or valid callback payload')

export const telegramTaskPayloadSchema = z
  .object({
    updateId: telegramId,
    queueKey: z.string().uuid(),
    sealedEnvelope: z.string().min(1).max(8192),
  })
  .strict()

export type TelegramPlaintextPayload = z.infer<typeof telegramPlaintextPayloadSchema>
export type TelegramTaskPayload = z.infer<typeof telegramTaskPayloadSchema>
