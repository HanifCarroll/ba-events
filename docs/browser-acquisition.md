# Daily browser acquisition

The daily 06:00 Buenos Aires discovery schedule and its source horizons are unchanged. It runs in the `baeventos-jobs` Worker (`src/jobs-worker/`) as the `baeventos-daily-scrape` Workflow. Meetup and BA Tourism load their pages in Cloudflare Browser Rendering through the Worker's `BROWSER` binding and `@cloudflare/playwright`. Luma is a plain HTTP read. Passline, Eventbrite, and Venti were removed on 2026-11-15; the events they imported stay in the catalog and age out.

Meetup reads one page per day for 14 days, and every requested day must succeed. The final date includes the entire Buenos Aires calendar day. Meetup detail pages are direct HTTP reads. BA Tourism renders its weekly page once.

Each source opens one browser session, reuses it for the run, and closes it when its step ends (`src/jobs-worker/browser.ts`). Sessions are rotated after 32 page reads or eight minutes. There is no paid fallback provider: a Browser Rendering failure fails that source's step, which retries.

Anonymous source observations are kept in the private `source-acquisitions` Supabase Storage bucket. The bucket contains no API keys, cookies, auth headers, or user data. A completed observation is reused when its Workflow step retries; failed reads are not cached. Successful protected details can also be reused by a same-day catch-up run, with a Buenos Aires date partition. A new daily catalog read is always fresh. Meetup detail HTTP requests revalidate ETag/Last-Modified and reuse a body only on 304; 200 replaces it. Missing validators cause a full fresh GET. Successfully stored event descriptions retain the existing translate-only reuse policy, not an asserted daily refresh of every historical detail page.

Memory holds at most 256 entries. Retry entries expire after 48 hours and HTTP validator entries after seven days. The daily run removes expired bucket objects older than seven days in bounded batches. Storage errors degrade reuse with a warning rather than deferring discovery.

The daily enrichment ceiling scales to the observed eligible population. Failed rows remain excluded from later batches of that chain and are retried by the scheduled catch-up.

## Source health checks

Run `bun run source:health` with the existing service-role environment to read the latest 30 daily runs and four exact counts of upcoming scheduled events. It makes no provider/model calls or database writes and excludes raw source errors and content. Exit 1 means an actionable signal, unknown measurement or unavailable read; the JSON separates those cases. The 36-hour source-age threshold allows the daily schedule a twelve-hour grace period.

Daily finalization retains source catalog/filter/expansion/unchanged counts when supplied, categorization outcomes and a timestamped health snapshot, and logs a warning for failed/stale/empty sources, processing skips or categorization fallbacks. Zero writes can mean unchanged inventory. Filtered counts are the retained eligible set; expanded Meetup/BA Tourism entries are a different count. None of these measurements establishes exhaustive marketplace coverage. Legacy aggregate `scrape_runs.events_fetched` remains an import-processing total; use the per-source `metadata.results[].eventsFetched` for actual catalog counts. `scrape_runs.trigger_id` now holds the Workflow instance ID.

The read-only command also reports the latest daily chain's measured enrichment outcomes and current scheduled/upcoming inventory counts: total, both primary language descriptions null, explicitly unavailable descriptions and failed enrichment. Description absence includes work still pending; it is not automatically an extraction failure. The four inventory queries are separate reads, not an atomic inventory snapshot. Final chain counts are in `metadata.enrichment`.

## Checking sources without writing

`baeventos-source-check` is an unscheduled Workflow that reads each source's catalog and returns the event count and three sample names. It makes no database, model, or embedding calls and does not need the Supabase secrets. Payload `{"days": N}` (1 to 14, default 1) sets the Meetup window.

```sh
bunx wrangler workflows trigger baeventos-source-check '{"days":14}' --config wrangler.jobs.jsonc
bunx wrangler workflows instances describe baeventos-source-check latest --config wrangler.jobs.jsonc
```

Locally, `bunx wrangler dev --config wrangler.jobs.jsonc --env-file /dev/null` runs the same Workflow with the remote browser binding (it uses the account's included browser time); add `--local --port <port>` to the trigger and describe commands.
