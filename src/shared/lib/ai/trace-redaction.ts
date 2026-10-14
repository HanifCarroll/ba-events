import type { Attributes, AttributeValue } from '@opentelemetry/api'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { sanitizeError } from '../security.ts'

const PRIVATE_FIELDS = new Set([
  'authorization', 'cookie', 'set-cookie', 'password', 'secret', 'token',
  'api_key', 'apikey', 'api-key', 'x-api-key', 'access_token', 'refresh_token',
  'token_hash', 'credential', 'credentials', 'deliverycapability',
  'secret_key', 'secretkey', 'accesstoken', 'refreshtoken', 'tokenhash',
  'api_token', 'apitoken', 'jwt', 'delivery_token', 'deliverytoken',
])

function privateField(key: string): boolean {
  return PRIVATE_FIELDS.has(key.toLowerCase().split('.').at(-1) ?? '')
}

function redactText(value: string): string {
  return sanitizeError(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
    .replace(/\+\d[\d ()-]{6,}\d/g, (phone) => {
      const digits = phone.replace(/\D/g, '').length
      return digits >= 8 && digits <= 15 ? '[PHONE_REDACTED]' : phone
    })
    .replace(/\b((?:authorization\s*[:=]\s*)?(?:Bearer|Basic)\s+)[A-Z0-9+/=_-]+(?:\.[A-Z0-9+/=_-]+)*/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+\b/gi, '[REDACTED]')
    .replace(/\bsk-(?:lf-|proj-)?[A-Z0-9_-]{10,}\b/gi, '[REDACTED]')
    .replace(/\b((?:password|api[_-]?key|access_token|refresh_token|token|secret)\s*[:=]\s*["']?)[^\s"'&,;]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/gi, (text) => {
      try {
        const url = new URL(text)
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        return url.href
      } catch { return '[URL_REDACTED]' }
    })
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, privateField(key) ? '[REDACTED]' : redactValue(item),
    ]))
  }
  return value
}

/** Keep structured trace content readable without changing model inputs/results. */
export function redactTraceText(value: string): string {
  try { return JSON.stringify(redactValue(JSON.parse(value))) }
  catch { return redactText(value) }
}

function redactAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key,
    privateField(key) ? '[REDACTED]'
      : typeof value === 'string' ? redactTraceText(value)
      // Strings stay strings; numeric/boolean arrays retain their original kind.
      : Array.isArray(value) ? value.map((item) => typeof item === 'string' ? redactTraceText(item) : item) as AttributeValue
      : value,
  ]))
}

/** Copy only export data; SDK spans and the application result stay intact. */
function redactSpan(span: ReadableSpan): ReadableSpan {
  return {
    name: redactTraceText(span.name), kind: span.kind,
    spanContext: () => span.spanContext(), parentSpanContext: span.parentSpanContext,
    startTime: span.startTime, endTime: span.endTime,
    status: { ...span.status, message: span.status.message ? redactTraceText(span.status.message) : undefined },
    attributes: redactAttributes(span.attributes),
    links: span.links.map((link) => ({ ...link, attributes: link.attributes ? redactAttributes(link.attributes) : undefined })),
    events: span.events.map((event) => ({ ...event, name: redactTraceText(event.name), attributes: event.attributes ? redactAttributes(event.attributes) : undefined })),
    duration: span.duration, ended: span.ended, resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount, droppedLinksCount: span.droppedLinksCount,
  }
}

/** Cover raw AI/GenAI attributes as well as Langfuse-specific attributes. */
export function redactingSpanProcessor(processor: SpanProcessor): SpanProcessor {
  return {
    onStart: (span, context) => processor.onStart(span, context),
    onEnd: (span) => {
      try { processor.onEnd(redactSpan(span)) }
      catch { console.warn('[langfuse] redaction failed; span omitted') }
    },
    forceFlush: () => processor.forceFlush(), shutdown: () => processor.shutdown(),
  }
}
