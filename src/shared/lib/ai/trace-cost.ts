import type { Attributes } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

const PRICE_VERSION = 'deepseek-flash-2026-09-10'
const PRICE_START = Date.parse('2026-09-10T04:00:00Z')

/** Published USD/token rates; estimates exclude other providers and infrastructure. */
function pricesAt(time: number) {
  const date = new Date(time)
  const weekday = date.getUTCDay() >= 1 && date.getUTCDay() <= 5
  const hour = date.getUTCHours()
  const peak = weekday && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
  return { period: peak ? 'peak' : 'off_peak', input: peak ? 0.3 : 0.15,
    cached: peak ? 0.006 : 0.003, output: peak ? 1.2 : 0.6 }
}

function reportedTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Export-only estimate for a completed DeepSeek response with all required counters. */
export function deepseekCostEstimateAttributes(span: Pick<ReadableSpan, 'attributes' | 'startTime' | 'endTime'>): Attributes | undefined {
  const attributes = span.attributes
  if (attributes['langfuse.observation.cost_details'] !== undefined ||
    attributes['gen_ai.provider.name'] !== 'deepseek' ||
    attributes['gen_ai.response.model'] !== 'deepseek-flash') return undefined

  const input = attributes['gen_ai.usage.input_tokens']
  const cached = attributes['gen_ai.usage.cache_read.input_tokens']
  const output = attributes['gen_ai.usage.output_tokens']
  if (!reportedTokens(input) || !reportedTokens(cached) || !reportedTokens(output) || cached > input) return undefined

  const start = span.startTime[0] * 1000 + span.startTime[1] / 1_000_000
  const end = span.endTime[0] * 1000 + span.endTime[1] / 1_000_000
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < PRICE_START || end < start) return undefined
  const prices = pricesAt(start)
  // Calls straddling a price boundary are unknown rather than assigned one rate.
  if (prices.period !== pricesAt(end).period) return undefined

  return {
    'langfuse.observation.cost_details': JSON.stringify({
      input: (input - cached) * prices.input / 1_000_000,
      input_cached_tokens: cached * prices.cached / 1_000_000,
      output: output * prices.output / 1_000_000,
    }),
    'langfuse.observation.metadata.costEstimateKind': 'published_token_rates',
    'langfuse.observation.metadata.costEstimateVersion': PRICE_VERSION,
    'langfuse.observation.metadata.costEstimatePeriod': prices.period,
    'langfuse.observation.metadata.costEstimateTimeBasis': 'model_span_start',
  }
}
