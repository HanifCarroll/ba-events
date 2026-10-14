import { describe, expect, it } from 'vitest'
import { BasicTracerProvider, InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { deepseekCostEstimateAttributes } from './trace-cost.ts'
import { redactingSpanProcessor } from './trace-redaction.ts'

function modelSpan(start: string, attributes: ReadableSpan['attributes'] = {}, end?: string): Pick<ReadableSpan, 'attributes' | 'startTime' | 'endTime'> {
  const time = (date: string): [number, number] => [Date.parse(date) / 1000, 0]
  return { startTime: time(start), endTime: time(end ?? start), attributes: {
    'gen_ai.provider.name': 'deepseek', 'gen_ai.response.model': 'deepseek-flash',
    'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.cache_read.input_tokens': 600,
    'gen_ai.usage.output_tokens': 200, ...attributes,
  } }
}

describe('DeepSeek trace cost estimates', () => {
  it('charges cached input separately from total input without changing the original span', () => {
    const span = modelSpan('2026-10-14T15:00:00Z')
    const result = deepseekCostEstimateAttributes(span)
    const costs = JSON.parse(result!['langfuse.observation.cost_details'] as string)
    expect(costs.input).toBeCloseTo(0.00006, 12)
    expect(costs.input_cached_tokens).toBeCloseTo(0.0000018, 12)
    expect(costs.output).toBeCloseTo(0.00012, 12)
    expect(costs.total).toBeCloseTo(0.0001818, 12)
    expect(result!['langfuse.observation.metadata.costEstimatePeriod']).toBe('off_peak')
    expect(span.attributes['langfuse.observation.cost_details']).toBeUndefined()
  })

  it.each([
    ['2026-10-14T00:59:59Z', 'off_peak'], ['2026-10-14T01:00:00Z', 'peak'],
    ['2026-10-14T03:59:59Z', 'peak'], ['2026-10-14T04:00:00Z', 'off_peak'],
    ['2026-10-14T06:00:00Z', 'peak'], ['2026-10-14T09:59:59Z', 'peak'],
    ['2026-10-14T10:00:00Z', 'off_peak'], ['2026-10-17T02:00:00Z', 'off_peak'],
    ['2026-10-18T07:00:00Z', 'off_peak'],
  ])('uses the published UTC period at %s', (time, period) => {
    const result = deepseekCostEstimateAttributes(modelSpan(time))
    expect(result!['langfuse.observation.metadata.costEstimatePeriod']).toBe(period)
    expect(JSON.parse(result!['langfuse.observation.cost_details'] as string).output)
      .toBeCloseTo(period === 'peak' ? 0.00024 : 0.00012, 12)
  })

  it.each([
    { 'gen_ai.usage.cache_read.input_tokens': undefined },
    { 'gen_ai.usage.input_tokens': -1 }, { 'gen_ai.usage.output_tokens': 1.5 },
    { 'gen_ai.usage.output_tokens': NaN }, { 'gen_ai.usage.cache_read.input_tokens': 1001 },
    { 'gen_ai.response.model': 'another-model' }, { 'gen_ai.provider.name': 'another-provider' },
    { 'langfuse.observation.cost_details': '{"total":1}' },
  ])('preserves unknown or already supplied cost for %j', (attributes) => {
    const span = modelSpan('2026-10-14T15:00:00Z', attributes)
    expect(deepseekCostEstimateAttributes(span)).toBeUndefined()
  })

  it('retains reported zero usage and declines earlier rates or a crossed period', () => {
    const result = deepseekCostEstimateAttributes(modelSpan('2026-10-14T15:00:00Z', {
      'gen_ai.usage.input_tokens': 0, 'gen_ai.usage.cache_read.input_tokens': 0, 'gen_ai.usage.output_tokens': 0,
    }))
    expect(JSON.parse(result!['langfuse.observation.cost_details'] as string))
      .toEqual({ input: 0, input_cached_tokens: 0, output: 0, total: 0 })
    for (const span of [modelSpan('2026-09-10T03:00:00Z'),
      modelSpan('2026-10-14T00:59:59Z', {}, '2026-10-14T01:00:01Z')]) {
      expect(deepseekCostEstimateAttributes(span)).toBeUndefined()
    }
  })

  it('exports estimates through the actual Langfuse processor while retaining redaction', async () => {
    const exporter = new InMemorySpanExporter()
    const processor = new LangfuseSpanProcessor({ exporter, publicKey: 'test', secretKey: 'test',
      mediaUploadEnabled: false, shouldExportSpan: () => true, flushInterval: 60 })
    const provider = new BasicTracerProvider({ spanProcessors: [redactingSpanProcessor(processor)] })
    const span = provider.getTracer('ai').startSpan('model call', {
      startTime: new Date('2026-10-14T15:00:00Z'), attributes: {
        ...modelSpan('2026-10-14T15:00:00Z').attributes,
        'langfuse.observation.type': 'generation', 'langfuse.observation.model.name': 'deepseek-flash',
        'gen_ai.input.messages': 'jazz guest@example.test',
      },
    })
    span.end(new Date('2026-10-14T15:00:01Z'))
    try {
      await processor.forceFlush()
      const exported = exporter.getFinishedSpans()
      expect(exported).toHaveLength(1)
      expect(exported[0].attributes['langfuse.observation.cost_details']).toBeDefined()
      expect(exported[0].attributes['langfuse.observation.metadata.costEstimateKind']).toBe('published_token_rates')
      expect(exported[0].attributes['gen_ai.input.messages']).toBe('jazz [EMAIL_REDACTED]')
      expect((span as unknown as ReadableSpan).attributes['langfuse.observation.cost_details']).toBeUndefined()
    } finally { await provider.shutdown() }
  })
})
