import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import { AI_BASE_URL, AI_MODEL, EMBEDDING_MODEL } from './constants'

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
 * Spread into generateText/generateObject/streamText to disable DeepSeek's
 * thinking mode — required for calls with small token budgets (categorization,
 * extraction) and for snappy chat responses.
 */
export const NO_THINKING = {
  providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
} as const
