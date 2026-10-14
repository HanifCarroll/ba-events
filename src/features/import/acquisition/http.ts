import { Schema } from 'effect'
import { browserHeaders } from '#shared/lib/html-parsing.ts'
import { readAcquisitionCache, writeAcquisitionCache } from './cache.ts'
import { reuseAcquisition } from './run.ts'

const observationSchema = Schema.Struct({
  html: Schema.String, etag: Schema.NullOr(Schema.String), modified: Schema.NullOr(Schema.String),
  sourceObservedAt: Schema.optional(Schema.NullOr(Schema.String)),
})

export interface HtmlObservation {
  html: string
  sourceObservedAt: string | null
  sourceValidatedAt: string
}

export interface HttpAcquisitionDependencies {
  read: (key: string) => Promise<unknown>
  write: (key: string, value: unknown, ttlMs: number) => Promise<void>
  fetch: typeof fetch
}
export async function fetchRevalidatedHtml(url: string, dependencies: HttpAcquisitionDependencies = {
  read: readAcquisitionCache, write: writeAcquisitionCache, fetch: (...args) => fetch(...args),
}): Promise<string> {
  return (await fetchRevalidatedHtmlObservation(url, dependencies)).html
}

export async function fetchRevalidatedHtmlObservation(url: string, dependencies: HttpAcquisitionDependencies = {
  read: readAcquisitionCache, write: writeAcquisitionCache, fetch: (...args) => fetch(...args),
}): Promise<HtmlObservation> {
  return reuseAcquisition(`http:v2:en-US:${url}`, async () => {
    const key = `http:validators:v1:en-US:${url}`
    const raw = await dependencies.read(key)
    const parsed = Schema.decodeUnknownResult(observationSchema)(raw)
    const previous = parsed._tag === 'Success' ? parsed.success : undefined
    const headers: Record<string, string> = { ...browserHeaders }
    if (previous?.etag) headers['If-None-Match'] = previous.etag
    if (previous?.modified) headers['If-Modified-Since'] = previous.modified
    const response = await dependencies.fetch(url, { headers, signal: AbortSignal.timeout(20000) })
    if (response.status === 304 && previous) {
      return { html: previous.html, sourceObservedAt: previous.sourceObservedAt ?? null, sourceValidatedAt: new Date().toISOString() }
    }
    if (!response.ok) throw new Error(`Source detail HTTP ${response.status}`)
    const html = await response.text()
    if (!html || /<title[^>]*>\s*(Just a moment|Access denied)|verify you are human|cf-chl-/i.test(html)) {
      throw new Error('Source detail returned empty or challenged HTML')
    }
    const observedAt = new Date().toISOString()
    await dependencies.write(key, { html, sourceObservedAt: observedAt, etag: response.headers.get('etag'), modified: response.headers.get('last-modified') }, 7 * 24 * 60 * 60 * 1000)
    return { html, sourceObservedAt: observedAt, sourceValidatedAt: observedAt }
  })
}
