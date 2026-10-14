import { describe, expect, it } from 'vitest'
import { SpanStatusCode } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { redactTraceText, redactingSpanProcessor } from './trace-redaction.ts'

describe('trace content redaction', () => {
  it('retains conversation facts, dates and identifiers while masking common contact details and credentials', () => {
    const input = { role: 'user', content: 'Jazz on 2026-10-14. Email guest@example.test or +54 (11) 5555-0100.',
      tool: { event_id: 'event-1', price: 2500, password: 'short', Authorization: 'Bearer private',
        url: 'https://user:pass@example.test/event?token=secret#private' } }
    const result = JSON.parse(redactTraceText(JSON.stringify(input)))
    expect(result.content).toBe('Jazz on 2026-10-14. Email [EMAIL_REDACTED] or [PHONE_REDACTED].')
    expect(result.tool).toEqual({ event_id: 'event-1', price: 2500, password: '[REDACTED]',
      Authorization: '[REDACTED]', url: 'https://example.test/event' })
    expect(input.tool.password).toBe('short')
  })

  it('redacts prose credentials without deleting useful chat text', () => {
    expect(redactTraceText('Try jazz; password=short and Bearer abc123.'))
      .toBe('Try jazz; password=[REDACTED] and Bearer [REDACTED].')
    expect(redactTraceText('Bearer eyJheader.payload.signature. sk-lf-fakeonly123456'))
      .toBe('Bearer [REDACTED]. [REDACTED]')
    expect(redactTraceText('Find jazz. sk_test_BAReleaseCanary1234567890; sk_live_fakeonly123456; rk_live_fakeonly123456.'))
      .toBe('Find jazz. [REDACTED]; [REDACTED]; [REDACTED].')
  })

  it('omits a span if redaction cannot read it', () => {
    let exports = 0
    const processor = redactingSpanProcessor({ onStart() {}, onEnd() { exports++ },
      forceFlush: async () => {}, shutdown: async () => {} })
    const unreadable = { get name(): string { throw new Error('private detail') } } as ReadableSpan
    expect(() => processor.onEnd(unreadable)).not.toThrow()
    expect(exports).toBe(0)
  })

  it('redacts the actual Langfuse export including raw AI attributes, errors and links', async () => {
    const exporter = new InMemorySpanExporter()
    const processor = new LangfuseSpanProcessor({ exporter, publicKey: 'test', secretKey: 'test',
      mediaUploadEnabled: false, shouldExportSpan: () => true, flushInterval: 60 })
    const provider = new BasicTracerProvider({ spanProcessors: [redactingSpanProcessor(processor)] })
    const span = provider.getTracer('ai').startSpan('model call', {
      attributes: {
        'langfuse.observation.input': JSON.stringify({ content: 'Find jazz guest@example.test', token: 'short-secret' }),
        'gen_ai.input.messages': 'Email guest@example.test sk_test_BAReleaseCanary1234567890',
        'ai.prompt.messages': JSON.stringify([{ role: 'user', content: '+54 (11) 5555-0100' }]),
        'gen_ai.tool.result': JSON.stringify({ name: 'Jazz show', url: 'https://example.test/event?token=short-secret' }),
        'gen_ai.usage.input_tokens': 10,
        'langfuse.observation.metadata.configurationId': 'a'.repeat(64),
      },
      links: [{ context: { traceId: 'b'.repeat(32), spanId: 'c'.repeat(16), traceFlags: 1 },
        attributes: { authorization: 'Bearer short-secret' } }],
    })
    span.addEvent('exception', { 'exception.message': 'guest@example.test Bearer short-secret' })
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'guest@example.test' })
    span.end()
    try {
      await processor.forceFlush()
      const exported = exporter.getFinishedSpans()
      expect(exported).toHaveLength(1)
      const data = JSON.stringify({ attributes: exported[0].attributes, events: exported[0].events,
        links: exported[0].links, status: exported[0].status })
      for (const privateValue of ['guest@example.test', 'short-secret', '+54 (11) 5555-0100', 'sk_test_BAReleaseCanary1234567890']) {
        expect(data).not.toContain(privateValue)
      }
      expect(data).toContain('Find jazz')
      expect(data).toContain('Jazz show')
      expect(exported[0].attributes['gen_ai.usage.input_tokens']).toBe(10)
      expect(exported[0].attributes['langfuse.observation.metadata.configurationId']).toBe('a'.repeat(64))
      expect((span as unknown as ReadableSpan).attributes['gen_ai.input.messages']).toBe('Email guest@example.test sk_test_BAReleaseCanary1234567890')
    } finally { await provider.shutdown() }
  })
})
