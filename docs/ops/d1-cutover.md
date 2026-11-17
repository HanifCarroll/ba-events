# D1 cutover runbook

This is the one-time move of production from Supabase to D1, Vectorize, and R2. Hermes runs it on a weekday from 01:00 to 02:00 Buenos Aires time. That window is clear of the 03:00 reconcile, the 06:00 scrape, and the 09:00 intake. It follows the plan's cutover steps 1 to 7. The switch is the cutover PR: it binds D1 (`DB`), Vectorize (`VECTORIZE`), and R2 in every production wrangler config. A Worker with those bindings runs on Cloudflare, and a Worker without them runs on Supabase. The PR is held, and Hermes merges it only inside the window, after the copy into production passes `verify`. Production therefore never runs against an empty database.

Run every command from a clean checkout of the cutover branch on the Pro, which has the Wrangler login and the copy tool's Node. Put a `timeout` on long commands. Use `node` for the copy tool, because Wrangler's remote proxy hangs under Bun 1.3.14. Never print `.env`, tokens, or user emails.

```sh
cd ~/projects/ba-events-delivery && git fetch && git checkout pi/08-cutover && git pull --ff-only
export PATH=$HOME/.local/share/mise/shims:$PATH
```

## 1. Before the window (any day before it)

1. **Search baselines.** Capture them from production, read-only. You'll compare them after the switch.

   ```sh
   bun run eval:search > /tmp/ba-baseline-search.txt; bun run eval:relevance > /tmp/ba-baseline-relevance.txt
   bun run snapshot:search-corpus
   ```

2. **A full staging rehearsal.** Run sections 3 to 5 against the `-staging` targets: run the copy tool without `--production`, then deploy the staging Workers ([D1 "Staging"](../d1.md#staging)). Note each step's time.
3. **Cloudflare resources.** Hermes creates these. They are the only production resources that are new:

   ```sh
   bunx wrangler d1 create baeventos-production --location enam
   bunx wrangler vectorize create baeventos-events --dimensions 1536 --metric cosine
   bunx wrangler vectorize create-metadata-index baeventos-events --property-name status --type string
   bunx wrangler vectorize create-metadata-index baeventos-events --property-name starts_at --type number
   bunx wrangler r2 bucket create baeventos-intake-evidence
   bunx wrangler r2 bucket create baeventos-artwork
   ```

   Create the metadata indexes before any vector is inserted. Vectorize indexes only vectors written after the index exists.
4. **Fill in the database id.** Replace `REPLACE_WITH_BAEVENTOS_PRODUCTION_D1_ID` in `wrangler.jsonc`, `wrangler.mcp.jsonc`, `wrangler.telegram.jsonc`, and `wrangler.jobs.jsonc` with the `database_id` that `d1 create` printed. Commit that to the PR branch. The deploy job runs `scripts/check-production-bindings.ts`, which refuses to deploy while any config still has the placeholder or the four ids differ. The names `baeventos-events`, `baeventos-intake-evidence`, and `baeventos-artwork` are already in the configs.
5. **Apply the schema to the new database:**

   ```sh
   bunx wrangler d1 migrations apply baeventos-production --remote --config wrangler.jsonc
   ```

6. **Secrets on the production Workers.** These are new. Setting them now changes nothing, because the running code doesn't read them.

   | Worker | Secret | Value |
   | --- | --- | --- |
   | `baeventos` | `AUTH_SECRET` | 32 or more random bytes (`openssl rand -base64 32`) |
   | `baeventos` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The `ba-eventos` Google Cloud OAuth client |
   | `baeventos-jobs` | `INTAKE_API_TOKEN` | 32 or more random characters, also kept in `~/.config/ba-events/intake-token` (mode 600) on the Pro |

   Set each one by piping the value, never echoing it: `... | bunx wrangler secret put AUTH_SECRET --config wrangler.jsonc`. `bunx wrangler secret list --config <config>` should also show `OPENAI_API_KEY` on `baeventos-mcp`, `baeventos-telegram`, and `baeventos-jobs`, which embed queries and events.
7. **Google.** Register `https://baeventos.com/api/auth/callback/google` as an authorized redirect URI in the `ba-eventos` Google Cloud project. Keep the Supabase callback until Supabase is deleted.
8. **Email.** `wrangler.jsonc` lets `EMAIL` send from `accounts@baeventos.com` as well as `alerts@`. `baeventos.com` is already onboarded for Email Sending. Nothing else is needed.
9. **GitHub Actions token.** `CLOUDFLARE_API_TOKEN` needs **D1 Edit** for the migrations step, **Vectorize Edit**, and **Workers R2 Storage Edit** for the R2 bindings. It already has D1 and Vectorize. Add R2 if it's missing, because without it the deploy fails before any Worker changes.
10. **Supabase billing.** Read Billing for `lofldohumpulpdtmaitk`. If the plan is paid, downgrade to Free when the 30-day hold starts.

## 2. Start the window (01:00)

1. Stop the intake. It writes to Supabase, and its writes would miss the copy.

   ```sh
   launchctl bootout gui/$(id -u)/com.hanif.ba-events-intake   # on the Pro
   ```

2. Set `DB_READ_ONLY=1` on `baeventos`, `baeventos-telegram`, and `baeventos-jobs`. The code running now ignores it. The new code reads it when it deploys in step 6, so production starts frozen on D1 until the smoke tests pass.

   ```sh
   for c in wrangler.jsonc wrangler.telegram.jsonc wrangler.jobs.jsonc; do printf 1 | bunx wrangler secret put DB_READ_ONLY --config $c; done
   ```

3. Pause Telegram. Run this on the VPS, from `~/projects/ba-events` with its `.env`, and don't drop pending updates. Telegram holds messages for 24 hours, and they arrive once the webhook is set again.

   ```sh
   bun --env-file=.env scripts/telegram-webhook.ts delete
   ```

What the freeze doesn't cover: before the deploy, the old code still writes guest diagnostics (`guest_request_lifecycle`, `guest_chat_debug`), rate-limit windows, feedback, and signed-in chat to Supabase. Those rows are lost between the export and the deploy. They are diagnostics or very rare at 01:00, so this is accepted. The 4 accounts' saved events and profiles are copied as they stand at export.

## 3. Export (about 7 minutes)

```sh
RUN=/tmp/ba-copy-prod-$(date +%Y%m%d-%H%M); mkdir -m 700 "$RUN"
time node --env-file=.env scripts/d1-migrate/export.ts --dir "$RUN"
```

## 4. Transform and load (about 10 minutes)

```sh
time node scripts/d1-migrate/transform.ts --dir "$RUN"
time node scripts/d1-migrate/load.ts --dir "$RUN" --production --d1 baeventos-production --vectorize baeventos-events \
  --evidence-bucket baeventos-intake-evidence --artwork-bucket baeventos-artwork
```

`load` empties the target tables, inserts batches of 500 rows, upserts the vectors unchanged, puts each R2 object with its sha256, and imports the 4 users with their Supabase ids. Then rebuild the full-text index:

```sh
cat > "$RUN/fts.sql" <<'SQL'
INSERT INTO events_fts(events_fts) VALUES ('rebuild');
SQL
bunx wrangler d1 execute baeventos-production --remote --config wrangler.jsonc --file "$RUN/fts.sql"
```

## 5. Verify (about 4 minutes; must pass)

```sh
time node --env-file=.env scripts/d1-migrate/verify.ts --dir "$RUN" --production --d1 baeventos-production \
  --vectorize baeventos-events --evidence-bucket baeventos-intake-evidence --artwork-bucket baeventos-artwork
```

`verify` exits 1 on any mismatch: a row count in any of the 28 tables, a field in 100 events or 50 venues, the vector count or 100 sampled vectors, an R2 hash, a user, or a production count that changed since the export. If it fails, find the cause, rerun `load` with `--only` for the failing part, and verify again. If the window runs out, go to "Abort before the switch".

## 6. Switch, in order

1. **Merge the PR.** Use `gh pr merge <number> --merge`. The `deploy` job checks the bindings and applies the migrations, which should report "No migrations to apply". Then it deploys Telegram, MCP, web, chat delivery, and jobs. Watch it with `gh run watch`. It takes about 8 minutes.
2. **Smoke tests.** Production is still frozen.

   ```sh
   curl -sS https://baeventos.com/ -o /dev/null -w '%{http_code}\n'                                        # 200
   curl -sS https://baeventos.com/api/events/happening-soon | head -c 300                                    # 4 events
   bin/ba-d1-read.sh "SELECT id FROM events WHERE status='scheduled' ORDER BY starts_at LIMIT 1"             # an id
   curl -sS https://baeventos.com/events/<that id> -o /dev/null -w '%{http_code}\n'                          # 200
   bun scripts/chat-smoke.ts --url https://baeventos.com --prompt "jazz this weekend"                        # guest chat with events
   curl -sS https://baeventos-mcp.paseaban-decorosa0m.workers.dev/mcp -H 'content-type: application/json' \
     -H 'accept: application/json, text/event-stream' -H 'X-BA-Eventos-Source: dogfood' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
     "params":{"name":"search_events","arguments":{"query":"jazz"}}}' | head -c 400                      # MCP search_events: events
   ```

   - Search: check that `bun scripts/chat-smoke.ts` returned events, and that the home page and an event page with an Instagram poster show their artwork.
   - Magic link: on https://baeventos.com/login, request a link for a test address that isn't one of the 4 users (`hanifcarroll@fastmail.com` was used in PR 07). Open it and confirm `/saved` loads. Saving answers 503 until the freeze is cleared, as intended.
   - Intake preflight through the API (on the Pro, from an intake checkout): `INTAKE_API_URL=https://baeventos-jobs.paseaban-decorosa0m.workers.dev INTAKE_API_TOKEN=$(cat ~/.config/ba-events/intake-token) bun run instagram:intake preflight` should show `schema_ready`, `storage_ready`, and `publishing_ready`.
3. **Clear the freeze.** Delete the secret on each Worker. The Workers pick up the change within seconds.

   ```sh
   for c in wrangler.jsonc wrangler.telegram.jsonc wrangler.jobs.jsonc; do yes | bunx wrangler secret delete DB_READ_ONLY --config $c; done
   ```

   Then save an event as the test user, and turn Telegram back on from the VPS: `bun --env-file=.env scripts/telegram-webhook.ts set`, then `... info` (0 pending after a minute).
4. **Jobs.** The crons are live from the deploy. Run one scrape and check it:

   ```sh
   bunx wrangler workflows trigger baeventos-daily-scrape --config wrangler.jobs.jsonc
   bunx wrangler workflows instances describe baeventos-daily-scrape latest --config wrangler.jobs.jsonc
   ```

5. **Intake.** In both Pro checkouts (`~/projects/ba-events` and `~/projects/ba-events-instagram-intake`), run `git pull --ff-only`. Then add `INTAKE_API_URL=https://baeventos-jobs.paseaban-decorosa0m.workers.dev` and `INTAKE_API_TOKEN=<the jobs secret>` to `.env`, run `bun run instagram:intake preflight`, and reload the agent:

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hanif.ba-events-intake.plist
   ```

6. **Hermes' reads.** Use `bin/ba-d1-read.sh "SELECT ..."` (production, read-only, with the deploy token in `~/.config/ba-events/cloudflare-deploy-token`). Writes are reviewed `.sql` files run with `bunx wrangler d1 execute baeventos-production --remote --config wrangler.jsonc --file <file>`. A fix that changes protected event facts inserts into `write_context` first and deletes from it last, in the same file ([D1](../d1.md#writing-from-server-code)). `/intake/sources` replaces `import_sources.py`.
7. **Baselines.** Run `bun run eval:search` and `bun run eval:relevance` again, and compare them with step 1.

## 7. Rollback

Supabase stays as it was: nothing in the window writes to it after the export.

- **Abort before the switch** (verify fails or time runs out). Don't merge. Delete `DB_READ_ONLY` (the old code ignores it anyway), set the Telegram webhook again, and reload the intake LaunchAgent. Production never left Supabase.
- **Within 48 hours of the switch,** revert the merge on `main`. The deploy job deploys the old configs, which have no D1 bindings, so every Worker reads Supabase again. Writes made to D1 since the switch are lost: scrapes repeat on their own, and intake publishes can be redone from the run's evidence. Remove `INTAKE_API_URL` and `INTAKE_API_TOKEN` from both intake `.env` files. After the first good intake run on D1, fix forward instead.
- **Mistakes inside D1** are covered by Time Travel (30 days): `bunx wrangler d1 time-travel restore baeventos-production --timestamp <ISO time> --config wrangler.jsonc`.

## 8. Afterwards

- After 48 clean hours, queue `09-remove-supabase`.
- Before deleting Supabase, wait for 30 days without a rollback, a Time Travel restore drill on staging, and a final JSONL and Storage archive in a private R2 bucket. Then Hermes pauses the project for 7 days, deletes it, and removes the Supabase secrets, the `PUBLIC_SUPABASE_*` variables, and the Supabase callback in Google.
