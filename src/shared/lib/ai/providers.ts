import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import { AI_BASE_URL, AI_MODEL, EMBEDDING_MODEL } from './constants.ts'

/**
 * AI SDK providers.
 *
 * Text generation runs on DeepSeek V4 Flash through its OpenAI-compatible
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
 * Concierge chat only. Adaptive thinking lets DeepSeek reason on ambiguous
 * asks (e.g. "next weekend" on a Saturday) and skip it on simple ones.
 */
export const CHAT_THINKING = {
  providerOptions: { deepseek: { thinking: { type: 'adaptive' } } },
} as const
