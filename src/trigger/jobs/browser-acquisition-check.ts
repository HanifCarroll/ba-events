import { task } from '@trigger.dev/sdk/v3'
import { Schema, Effect } from 'effect'
import { withAcquisitionRun } from '#features/import/acquisition/run.ts'
import { fetchPasslineEventsWithBrowserbase } from '#features/import/scrapers/passline/browser-scraper.ts'
import { filterCABAEvents, filterByDateRange } from '#features/import/scrapers/passline/api.ts'
import { scrapeMeetupEvents } from '#features/import/scrapers/meetup/browser-scraper.ts'
import { fetchMeetupEventDetail } from '#features/import/scrapers/meetup/detail.ts'
import { passlineEnrichmentAdapter } from '#features/import/adapters/enrichment/passline-enrichment.ts'
import { getBlocklistEntries } from '#shared/lib/db/blocklist.ts'
import { fetchExistingPasslineEventsEffect } from '#features/import/core/passline-existing.ts'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { browserbaseScraperQueue } from '../queues.ts'

const payloadSchema = Schema.Struct({ approved: Schema.Literal(true), startDate: Schema.String, meetupEndDate: Schema.String, passlineEndDate: Schema.String })

/** Explicit, unscheduled source verification. No event writes, AI, or redundant imports. */
export const browserAcquisitionCheck = task({
  id: 'browser-acquisition-check', machine: 'medium-1x', maxDuration: 450,
  retry: { maxAttempts: 1 }, queue: browserbaseScraperQueue,
  run: async (input: unknown, { ctx }) => {
    const payload = Schema.decodeUnknownSync(payloadSchema)(input)
    const start = Date.parse(payload.startDate)
    for (const [end, maxDays] of [[payload.meetupEndDate, 14], [payload.passlineEndDate, 30]] as const) {
      const days = (Date.parse(end) - start) / 86400000
      if (!Number.isFinite(days) || days < 0 || days > maxDays) throw new Error('Verification window exceeds approved production horizon')
    }
    const startedAt = new Date().toISOString()
    const meetup = await withAcquisitionRun(`${ctx.run.id}:meetup`, async () => {
      const events = await scrapeMeetupEvents({ startDate: payload.startDate, endDate: payload.meetupEndDate })
      const details = await Promise.all(events.slice(0, 6).map(event => fetchMeetupEventDetail(event.eventUrl)))
      return { days: (Date.parse(payload.meetupEndDate) - start) / 86400000 + 1, events: events.length, detailSamples: details.length, descriptions: details.filter(detail => detail?.description).length }
    })
    const passline = await withAcquisitionRun(`${ctx.run.id}:passline`, async () => {
      const events = await fetchPasslineEventsWithBrowserbase()
      const client = createServiceRoleClient()
      const blocklist = await getBlocklistEntries('passline', client)
      const eligible = filterByDateRange(filterCABAEvents(events, blocklist), { startDate: payload.startDate, endDate: payload.passlineEndDate })
      const existing = await Effect.runPromise(fetchExistingPasslineEventsEffect(client, eligible.map(event => event.id)))
      const samples = [eligible.find(event => event.fecha_inicio === payload.startDate), eligible.find(event => event.fecha_inicio >= payload.startDate && Number(event.precio_min) === 0), ...eligible]
        .filter((event, index, all) => event && all.findIndex(candidate => candidate?.id === event.id) === index).slice(0, 6)
      const details = []
      for (const event of samples) {
        if (!event) continue
        const url = event.url.startsWith('http') ? event.url : `https://www.passline.com/${event.url.replace(/^\//, '')}`
        const detail = await passlineEnrichmentAdapter.serverEnrich!(url, { extractVenue: true })
        details.push({ id: event.id, descriptionLength: detail?.description_es?.length ?? 0, venuePresent: Boolean(detail?.venue_name) })
      }
      return { countryIds: events.length, eligibleIds: eligible.length, existingIds: existing.size, absentIds: eligible.length - existing.size, details }
    })
    return { startedAt, finishedAt: new Date().toISOString(), version: 'acquisition-v1', meetup, passline }
  },
})
