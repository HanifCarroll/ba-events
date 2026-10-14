# BA Eventos analytics

BA Eventos uses PostHog for a small, privacy-conscious product funnel. PostHog is enabled only on `baeventos.com` and `www.baeventos.com`.
PostHog respects Do Not Track and Global Privacy Control. Google Analytics respects Do Not Track.

## What is collected

| Event | Properties | Why |
| --- | --- | --- |
| `$pageview` | PostHog standard page properties | Which production pages people reach |
| `chat:message_sent` | `message_length`, `has_history`, `locale` | Chat demand |
| `chat:response_received` | `duration_ms`, `events_returned`, `response_id`, `response_kind`, `locale` | Completed replies and speed |
| `chat:feedback_shown` | `response_id`, `response_kind`, `events_returned`, `locale` | Completed replies with a visible feedback offer |
| `chat:helpfulness_rated` | `response_id`, `response_kind`, `events_returned`, `rating`, `previous_rating`, `locale` | Explicit helpful/not-helpful feedback |
| `chat:event_clicked` | `event_id`, `position`, `source`, optional `response_id`, `locale` | Recommendation engagement |
| `event:link_clicked` | `event_id`, `link_type`, optional `response_id`, `locale` | Ticket or RSVP intent |
| `event:saved` / `event:unsaved` | `event_id`, `source`, optional `response_id`, `locale` | Saved-event value |
| `chat:error` | `error_type`, `locale` | Customer-visible chat failures |
| `feedback:submitted` | `locale` | Feedback volume |
| `mcp:signpost_clicked` | `source`, `locale` | Homepage MCP interest |
| `mcp:endpoint_copied` | `locale` | MCP setup intent |

Authenticated people are identified with their application user ID, locale, and admin status. Email stays in Supabase and is not sent to PostHog.

PostHog also collects autocaptured interaction metadata, page-leave and scroll-depth data, heatmap positions, and session replays. Automatic interactions explicitly mask element text and attributes (`mask_all_text=true`, `mask_all_element_attributes=true`), and copied-text capture is disabled. Named outcome events remain available. The browser explicitly sets `session_recording.maskAllInputs=true` and `maskTextSelector='*'`, so replay text and input values are masked locally while layout and interaction timing remain useful. See [PostHog's replay privacy controls](https://posthog.com/docs/session-replay/privacy). Project settings still control which sessions record. Replay also masks all string-valued DOM attributes (`maskAllElementAttributes=true`), reducing replay styling/image fidelity. PostHog omits page titles and strips automatically captured URL fragments. Known auth/search query names are masked with the SDK’s `mask_personal_data_properties` and `custom_personal_data_properties`; referrer collection is disabled and referrer event properties are denied. This list is explicit: newly introduced query fields need privacy review. Separately supplied custom fields, replay/network URL coverage and historical data remain separate surfaces; verify deployed payloads before claiming complete telemetry redaction.

## What is deliberately not collected

- Chat text, search text, feedback text, error messages, or input values
- PostHog surveys
- Localhost and preview traffic
- Server-side agent, tool, fallback, or execution-trace telemetry

Feedback text is stored separately in the first-party `product_feedback` table when a person explicitly submits the form. It is not sent to PostHog.

## Response helpfulness

Completed web replies offer “Was this helpful?” / “¿Te sirvió esta respuesta?”
with two optional choices. Streaming, stopped, failed, and not-yet-persisted
replies cannot be rated. The control records its first viewport exposure and
explicit votes separately. Selecting the current choice does nothing; changing
it records the new and previous choice. Up to 200 selections/exposures are kept
in the current browser tab's session storage, surviving reloads. Restricted
storage falls back to the current component state. This is best-effort product
analytics, not durable first-party feedback submission or a cross-device ballot.

Use the opaque canonical `response_id` to join votes with completed responses
and their card clicks, saves and external-link actions in PostHog. Custom events
include actions in event details opened from that reply. Attribution is scoped
to the selected event in browser navigation state and never enters link URLs;
unrelated details clear it. Direct links/new tabs may lack that browser context.
Custom events
honor Do Not Track and Global Privacy Control. Ratings contain no prose, free-text
feedback, source content or credentials and are excluded from GA4. Telegram and
external MCP clients do not currently collect this web feedback.

For each reporting cohort, exclude admins and use unique response IDs, never raw
event counts. Use the **latest** vote per response (ordered by event timestamp)
so corrections replace earlier votes. Report these measures separately, with
their numerator, denominator, sample size, date range and English/Spanish split:

- Helpfulness: latest helpful votes / all rated responses.
- Rating coverage: rated responses / responses with a visible feedback offer.
- Offer coverage: responses with a visible feedback offer / completed responses.
- Click, save and external-action rates: responses with the action / completed
  responses. For a satisfaction comparison, also show the same actions within
  rated replies, split by latest vote, rather than assuming unrated replies agree.

Deduplicate even when session storage is unavailable, an old entry was evicted,
or someone returns in another session. Keep unrated replies unknown, not positive
or negative. A ticket/RSVP link click measures intent; purchases/attendance are
unobserved and must not be labeled conversion. No production satisfaction rates
are established until this change is released and real users provide ratings.

## Feedback alerts

Every successfully saved feedback submission can send an immediate email through Resend. Configure these server-side deployment variables:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key |
| `FEEDBACK_ALERT_FROM` | Verified Resend sender, for example `BA Eventos <feedback@baeventos.com>` |
| `FEEDBACK_ALERT_TO` | Alert recipient, for example `hanif@hanifcarroll.com` |

If delivery fails, the feedback remains saved and the person sees a successful submission. The alert includes the submitted feedback and is sent only to the configured recipient; it is never sent to PostHog.

## Reporting

Use PostHog directly for detailed product behavior. GA4 is limited to acquisition, page paths, and the existing browser outcome events so OpenSEO can report the acquisition-to-outcome funnel. Do not build a second analytics dashboard.

The core funnel is:

1. `chat:message_sent`
2. `chat:event_clicked`
3. `event:saved` or `event:link_clicked`

The MCP funnel is:

1. `mcp:signpost_clicked`
2. `/mcp` `$pageview`
3. `mcp:endpoint_copied`
4. Cloudflare Worker `mcp_tool_call`, split by `audience: dogfood | external`

Internal Codex and live smoke-test clients send `X-BA-Eventos-Source: dogfood`. The custom `mcp_tool_call` record contains only the resulting audience label, tool name, success status, and duration. Cloudflare's separate request metadata and the shared search service retain their existing operational fields.

Filter admin users from public-product reporting. Treat historical data as mixed with older local and broader tracking until the new production-only setup has accumulated enough data.
