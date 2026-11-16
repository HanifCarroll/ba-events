import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrowserWorker } from '@cloudflare/playwright'
import { withAcquisitionRun } from '#features/import/acquisition/run.ts'
import { processLumaImportEffect, type LumaImportResult } from '#features/import/core/luma.ts'
import { processMeetupImportEffect, type MeetupImportResult } from '#features/import/core/meetup.ts'
import { processBATourismImportEffect, type BATourismImportResult } from '#features/import/core/ba-tourism.ts'
import { fetchLumaEvents } from '#features/import/scrapers/luma/api.ts'
import { scrapeMeetupCatalog } from '#features/import/scrapers/meetup/browser-scraper.ts'
import { scrapeBATourismEventsWithBrowser } from '#features/import/scrapers/ba-tourism/browser-scraper.ts'
import { cloudflareBrowser } from './browser.ts'
import type { SourceId } from './source-health.ts'

export type SourceImportResult = LumaImportResult | MeetupImportResult | BATourismImportResult

/** Import one source. Acquisitions are keyed by `runId` so a retried step reuses a completed source read. */
export function importSource(
  id: SourceId,
  client: SupabaseClient,
  browser: BrowserWorker,
  runId: string,
  scrapeRunId: string
): Promise<SourceImportResult> {
  return withAcquisitionRun<SourceImportResult>(`${runId}:${id}`, () =>
    id === 'meetup' ? Effect.runPromise(processMeetupImportEffect(client, { daysAhead: 14, scrapeRunId, openBrowser: cloudflareBrowser(browser, id) }))
      : id === 'ba-tourism' ? Effect.runPromise(processBATourismImportEffect(client, { scrapeRunId, openBrowser: cloudflareBrowser(browser, id) }))
      : Effect.runPromise(processLumaImportEffect(client, { scrapeRunId })))
}

/** Catalog read only: no database, model, or embedding calls. Used to check a source without writing. */
export async function readSourceCatalog(id: SourceId, browser: BrowserWorker, startDate: string, endDate: string): Promise<{ source: SourceId; events: number; sample: string[] }> {
  const names = id === 'luma' ? (await fetchLumaEvents()).map(event => event.name)
    : id === 'meetup' ? (await scrapeMeetupCatalog({ startDate, endDate }, cloudflareBrowser(browser, id))).events.map(event => event.name)
    : (await scrapeBATourismEventsWithBrowser(cloudflareBrowser(browser, id))).events.map(event => event.name)
  return { source: id, events: names.length, sample: names.slice(0, 3) }
}
