/**
 * Shared Trigger.dev queues.
 *
 * Both Passline and Meetup scrapers consume a Browserbase cloud browser.
 * Running them concurrently collides on the shared browser session, so they
 * share a single queue with a concurrency limit of 1 — only one
 * Browserbase-consuming scraper runs at a time.
 */
import { queue } from '@trigger.dev/sdk/v3'

export const browserbaseScraperQueue = queue({
  name: 'browserbase-scrapers',
  concurrencyLimit: 1,
})
