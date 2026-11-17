import { Effect } from 'effect'
import type { CatalogStore } from '#features/import/core/catalog-store.ts'
import type { BrowserWorker } from '@cloudflare/playwright'
import { withAcquisitionRun } from '#features/import/acquisition/run.ts'
import { processLumaImportEffect, type LumaImportResult } from '#features/import/core/luma.ts'
import { processMeetupImportEffect, type MeetupImportResult } from '#features/import/core/meetup.ts'
import { processBATourismImportEffect, type BATourismImportResult } from '#features/import/core/ba-tourism.ts'
import { fetchLumaEvents } from '#features/import/scrapers/luma/api.ts'
import { fetchLumaEventDetail } from '#features/import/scrapers/luma/detail.ts'
import { scrapeMeetupCatalog } from '#features/import/scrapers/meetup/browser-scraper.ts'
import { scrapeBATourismEventsWithBrowser } from '#features/import/scrapers/ba-tourism/browser-scraper.ts'
import { cloudflareBrowser } from './browser.ts'
import type { SourceId } from './source-health.ts'

export type SourceImportResult = LumaImportResult | MeetupImportResult | BATourismImportResult

/** Import one source. Acquisitions are keyed by `runId` so a retried step reuses a completed source read. */
export function importSource(
  id: SourceId,
  catalog: CatalogStore,
  browser: BrowserWorker,
  runId: string,
  scrapeRunId: string
): Promise<SourceImportResult> {
  return withAcquisitionRun<SourceImportResult>(`${runId}:${id}`, () =>
    id === 'meetup' ? Effect.runPromise(processMeetupImportEffect(catalog, { daysAhead: 14, scrapeRunId, openBrowser: cloudflareBrowser(browser, id) }))
      : id === 'ba-tourism' ? Effect.runPromise(processBATourismImportEffect(catalog, { scrapeRunId, openBrowser: cloudflareBrowser(browser, id) }))
      : Effect.runPromise(processLumaImportEffect(catalog, { scrapeRunId })))
}

/** Catalog read only: no database, model, or embedding calls. Used to check a source without writing. */
export async function readSourceCatalog(id: SourceId, browser: BrowserWorker, startDate: string, endDate: string): Promise<{ source: SourceId; events: number; sample: string[]; detail?: { description: boolean; venue: string | null } }> {
  if (id === 'luma') {
    const events = await fetchLumaEvents()
    // Also read one event's detail, the call enrichment makes.
    const detail = events[0] ? await fetchLumaEventDetail(events[0].url) : null
    return { source: id, events: events.length, sample: events.slice(0, 3).map(event => event.name), detail: detail ? { description: Boolean(detail.description), venue: detail.venue?.name ?? null } : undefined }
  }
  const names = id === 'meetup'
    ? (await scrapeMeetupCatalog({ startDate, endDate }, cloudflareBrowser(browser, id))).events.map(event => event.name)
    : (await scrapeBATourismEventsWithBrowser(cloudflareBrowser(browser, id))).events.map(event => event.name)
  return { source: id, events: names.length, sample: names.slice(0, 3) }
}
