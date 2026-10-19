import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import { AI_BASE_URL, AI_MODEL, EMBEDDING_MODEL } from './constants.ts'

/**
 * AI SDK providers.
 *
 * Text generation runs on DeepSeek V4.1 Flash through its OpenAI-compatible
 * endpoint (@ai-sdk/deepseek). Embeddings stay on OpenAI (@ai-sdk/openai) —
 * DeepSeek has no embeddings API.
 */
export const deepseek = createDeepSeek({
  apiKey:
    process.env.AI_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.ANTHROPIC_API_KEY,
  ...(AI_BASE_URL ? { baseURL: AI_BASE_URL } : {}),
})

export const textModel = deepseek(AI_MODEL)

const DEEPSEEK_FLASH_MODEL = 'deepseek-flash'

export function shouldUseDeepSeekFlashCanary(requestId: string, percentage = Number(process.env.DEEPSEEK_FLASH_CANARY_PERCENT ?? 0)): boolean {
  if (!Number.isFinite(percentage) || percentage <= 0) return false
  if (percentage >= 100) return true
  let hash = 0
  for (const character of requestId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % 100 < percentage
}

export function textModelForRequest(requestId: string) {
  return shouldUseDeepSeekFlashCanary(requestId) ? deepseek(DEEPSEEK_FLASH_MODEL) : textModel
}

export const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
export const embeddingModel = openai.textEmbeddingModel(EMBEDDING_MODEL)

/**
 * Spread into generateText/generateObject to disable DeepSeek's thinking
 * mode. Required for small-budget structured calls (categorization,
 * extraction, titles, topic guard). Do not use this on the concierge chat.
 */
export const NO_THINKING = {
  providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
} as const

/**
 * Concierge chat only. The installed SDK maps the legacy adaptive alias to
 * enabled thinking. This does not select a thinking mode per user turn;
 * reasoning effort stays at the provider default unless explicitly evaluated.
 */
export const CHAT_THINKING = {
  providerOptions: { deepseek: { thinking: { type: 'adaptive' } } },
} as const
