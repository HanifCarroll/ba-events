# BA Eventos analytics

BA Eventos uses PostHog for a small, privacy-conscious product funnel. PostHog is enabled only on `baeventos.com` and `www.baeventos.com`.

## What is collected

| Event | Properties | Why |
| --- | --- | --- |
| `$pageview` | PostHog standard page properties | Which production pages people reach |
| `chat:message_sent` | `message_length`, `has_history`, `locale` | Chat demand |
| `chat:response_received` | `duration_ms`, `events_returned`, `locale` | Response quality and speed |
| `chat:event_clicked` | `event_id`, `position`, `source`, `locale` | Recommendation relevance |
| `event:link_clicked` | `event_id`, `link_type`, `locale` | Ticket or RSVP intent |
| `event:saved` / `event:unsaved` | `event_id`, `source`, `locale` | Saved-event value |
| `chat:error` | `error_type`, `locale` | Customer-visible chat failures |
| `feedback:submitted` | `locale` | Feedback volume |
| `mcp:signpost_clicked` | `source`, `locale` | Homepage MCP interest |
| `mcp:endpoint_copied` | `locale` | MCP setup intent |

Authenticated people are identified with their application user ID, locale, and admin status. Email stays in Supabase and is not sent to PostHog.

PostHog also collects autocaptured interaction metadata, page-leave and scroll-depth data, heatmap positions, and session replays. Replay privacy and masking follow the settings configured for the project in PostHog.

## What is deliberately not collected

- Chat text, search text, feedback text, error messages, or input values
- PostHog surveys
- Localhost and preview traffic
- Server-side agent, tool, fallback, or execution-trace telemetry

Feedback text is stored separately in the first-party `product_feedback` table when a person explicitly submits the form. It is not sent to PostHog.

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
