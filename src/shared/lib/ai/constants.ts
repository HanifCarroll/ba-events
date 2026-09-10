export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

// Text generation model, used through the Vercel AI SDK (@ai-sdk/deepseek).
// Defaults to DeepSeek V4.1 Flash via its OpenAI-compatible endpoint.
//
// AI_BASE_URL is overridable (e.g. a proxy); the API key resolves in order
// AI_API_KEY > DEEPSEEK_API_KEY > ANTHROPIC_API_KEY.
// To revert to Anthropic, re-add @ai-sdk/anthropic and swap the provider in
// src/shared/lib/ai/providers.ts.
export const DEEPSEEK_MODEL = 'deepseek-flash'
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const AI_MODEL = process.env.AI_MODEL ?? DEEPSEEK_MODEL
export const AI_BASE_URL = process.env.AI_BASE_URL ?? DEEPSEEK_BASE_URL
