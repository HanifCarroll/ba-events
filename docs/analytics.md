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

Authenticated people are identified with their application user ID, locale, and admin status. Email stays in Supabase and is not sent to PostHog.

## What is deliberately not collected

- Chat text, search text, feedback text, or error messages
- Session recordings, autocaptured clicks, page-leave events, or PostHog surveys
- Localhost and preview traffic
- Server-side agent, tool, fallback, or execution-trace telemetry

Feedback text is stored separately in the first-party `product_feedback` table when a person explicitly submits the form. It is not sent to PostHog.

## Reporting

Use PostHog directly. Do not build a second analytics dashboard or add GA4.

The core funnel is:

1. `chat:message_sent`
2. `chat:event_clicked`
3. `event:saved` or `event:link_clicked`

Filter admin users from public-product reporting. Treat historical data as mixed with older local and broader tracking until the new production-only setup has accumulated enough data.
