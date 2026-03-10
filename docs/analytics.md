# Analytics Implementation Guide

This document outlines the analytics strategy for BA Events using PostHog.

## Overview

BA Events uses PostHog for product analytics with a focus on:
- AI chat engagement and quality
- Event discovery behavior
- User retention and conversion
- Admin workflow efficiency

## PostHog Setup

### Installation

```bash
bun add posthog-js
```

### Environment Variables

Add to `.env`:

```
VITE_POSTHOG_KEY=phc_your_project_api_key
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

Get your API key from [PostHog Project Settings](https://us.posthog.com/settings/project).

### Provider Setup

Create `src/lib/analytics.ts`:

```typescript
import posthog from 'posthog-js'

// Only initialize in browser environment
export function initPostHog() {
  if (typeof window === 'undefined') return

  const apiKey = import.meta.env.VITE_POSTHOG_KEY
  const apiHost = import.meta.env.VITE_POSTHOG_HOST

  if (!apiKey) {
    console.warn('PostHog API key not configured')
    return
  }

  posthog.init(apiKey, {
    api_host: apiHost,
    // Capture pageviews automatically
    capture_pageview: true,
    // Capture clicks on links and buttons
    autocapture: true,
    // Persist across sessions
    persistence: 'localStorage+cookie',
    // Respect Do Not Track
    respect_dnt: true,
    // Mask sensitive inputs in session recordings
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-mask]',
    },
    // Filter out localhost in production
    loaded: (posthog) => {
      if (import.meta.env.DEV) {
        // Disable in development to avoid polluting data
        posthog.opt_out_capturing()
      }
    },
  })
}

export { posthog }
```

### Root Layout Integration

In `src/routes/__root.tsx`, initialize PostHog:

```typescript
import { initPostHog } from '@/lib/analytics'

// Initialize on client side
if (typeof window !== 'undefined') {
  initPostHog()
}
```

## User Identification

### When to Identify Users

Call `identify` in these scenarios:
1. **After login** - Associate anonymous events with the user
2. **After signup** - Link pre-signup behavior to new account
3. **On app load when authenticated** - Reconnect returning users

### Implementation

In `src/components/AuthProvider.tsx`, add identification:

```typescript
import { posthog } from '@/lib/analytics'

// After successful login/signup
function handleAuthStateChange(user: User | null) {
  if (user) {
    // Identify with user ID (never use email as distinct_id)
    posthog.identify(user.id, {
      email: user.email,
      created_at: user.created_at,
      // Add any relevant user properties
      locale: getLocale(),
    })
  }
}

// On logout - IMPORTANT: Reset to unlink future events
function handleSignOut() {
  posthog.reset()
}
```

### Person Properties

Set these properties on identification:

| Property | Type | Description |
|----------|------|-------------|
| `email` | string | User's email |
| `created_at` | datetime | Account creation date |
| `locale` | string | Preferred language (en/es) |
| `is_admin` | boolean | Admin role flag |
| `saved_events_count` | number | Number of saved events |

Update properties when they change:

```typescript
// When user saves an event
posthog.capture('event:saved', { event_id: eventId })
posthog.people.increment('saved_events_count')
```

## Event Taxonomy

Use the **category:object_action** naming convention for clarity and searchability.

### Naming Convention

```
{category}:{object}_{action}
```

- **category**: Feature area (chat, event, auth, admin)
- **object**: The thing being acted on (message, filter, button)
- **action**: What happened (sent, clicked, viewed)

### Property Naming

- Use `snake_case` for all properties
- Prefix booleans with `is_` or `has_`
- Include `_at` suffix for timestamps
- Include `_ms` suffix for durations

---

## Events to Track

### Chat Events (Core Feature)

These are the most important events - chat is the primary user experience.

| Event | Properties | Description |
|-------|------------|-------------|
| `chat:message_sent` | `query_length`, `is_first_message`, `session_message_count` | User sends a chat message |
| `chat:response_received` | `events_returned`, `response_time_ms`, `tools_used[]`, `has_error` | AI response completed |
| `chat:event_clicked` | `event_id`, `position`, `query` | User clicks an event from results |
| `chat:conversation_ended` | `message_count`, `session_duration_ms`, `events_clicked` | Chat session ends (tab close/navigate) |
| `chat:error` | `error_type`, `error_message`, `query` | Chat error occurred |
| `chat:no_results` | `query`, `filters_used` | Query returned zero events |

**Implementation:**

```typescript
// In chat component
const sendMessage = async (query: string) => {
  const startTime = Date.now()

  posthog.capture('chat:message_sent', {
    query_length: query.length,
    is_first_message: messages.length === 0,
    session_message_count: messages.length + 1,
  })

  try {
    const response = await streamChat(query)

    posthog.capture('chat:response_received', {
      events_returned: response.events?.length ?? 0,
      response_time_ms: Date.now() - startTime,
      tools_used: response.toolsUsed,
      has_error: false,
    })

    if (response.events?.length === 0) {
      posthog.capture('chat:no_results', {
        query,
        filters_used: extractFiltersFromQuery(query),
      })
    }
  } catch (error) {
    posthog.capture('chat:error', {
      error_type: error.name,
      error_message: error.message,
      query,
    })
  }
}
```

### Event Discovery

| Event | Properties | Description |
|-------|------------|-------------|
| `event:viewed` | `event_id`, `source`, `categories[]`, `neighborhood` | Event details viewed |
| `event:saved` | `event_id`, `categories[]`, `neighborhood`, `is_free` | User saves an event |
| `event:unsaved` | `event_id` | User removes saved event |
| `event:link_clicked` | `event_id`, `link_type` (ticket/venue/website) | External link clicked |
| `event:shared` | `event_id`, `share_method` | Event shared (if implemented) |

### Search & Filters

| Event | Properties | Description |
|-------|------------|-------------|
| `search:filters_applied` | `categories[]`, `vibes[]`, `neighborhood`, `time_filter`, `is_free`, `max_price` | Filters changed |
| `search:results_displayed` | `result_count`, `filters_used` | Search results shown |

### Authentication

| Event | Properties | Description |
|-------|------------|-------------|
| `auth:login_completed` | `method` (`magic_link`) | Magic-link callback completed and session established |
| `auth:login_failed` | `method`, `error` | Magic-link request or callback failed |
| `auth:logout` | - | User logged out |

### Admin Events

Track separately to understand admin workflow efficiency.

| Event | Properties | Description |
|-------|------------|-------------|
| `admin:import_started` | `source` | Import wizard started |
| `admin:import_completed` | `source`, `events_imported`, `venues_created`, `duration_ms` | Import finished |
| `admin:import_abandoned` | `source`, `step`, `reason` | Import wizard exited early |
| `admin:enrichment_started` | `event_count`, `fields[]` | Enrichment batch started |
| `admin:enrichment_completed` | `events_enriched`, `fields[]`, `duration_ms` | Enrichment finished |
| `admin:event_created` | `has_venue`, `categories[]`, `source` (manual) | Event manually created |
| `admin:event_updated` | `event_id`, `fields_changed[]` | Event edited |
| `admin:event_deleted` | `event_id`, `was_bulk` | Event deleted |
| `admin:venue_created` | `neighborhood`, `type` | Venue created |

### Performance & Errors

| Event | Properties | Description |
|-------|------------|-------------|
| `performance:page_load` | `route`, `load_time_ms` | Page load time |
| `error:api` | `endpoint`, `status_code`, `error_message` | API error |
| `error:client` | `error_type`, `error_message`, `component` | Client-side error |

---

## Key Metrics Dashboard

### North Star Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **Weekly Active Chatters** | Unique users who sent 1+ chat messages in 7 days | Growth |
| **Chat-to-Save Rate** | % of chat sessions resulting in a saved event | > 15% |
| **Return Rate** | % of users who return within 7 days | > 30% |

### User Engagement Dashboard

Create these insights in PostHog:

#### 1. Chat Quality
```sql
-- Average events returned per query
SELECT
  avg(properties.events_returned) as avg_events,
  date_trunc('day', timestamp) as day
FROM events
WHERE event = 'chat:response_received'
GROUP BY day
ORDER BY day DESC
```

#### 2. Zero-Result Queries
```sql
-- Track content gaps
SELECT
  properties.query,
  count(*) as occurrences
FROM events
WHERE event = 'chat:no_results'
GROUP BY properties.query
ORDER BY occurrences DESC
LIMIT 20
```

#### 3. Popular Categories
```sql
-- Most saved event categories
SELECT
  unnest(properties.categories) as category,
  count(*) as saves
FROM events
WHERE event = 'event:saved'
GROUP BY category
ORDER BY saves DESC
```

### Funnel: Chat to Conversion

Define this funnel in PostHog:

```
Step 1: chat:message_sent
Step 2: chat:event_clicked
Step 3: event:saved OR event:link_clicked
```

### Retention Analysis

Configure cohort retention:
- **Returning event**: `chat:message_sent`
- **Time period**: 7 days
- **Goal**: Users who chat once should return

---

## Implementation Checklist

### Phase 1: Core Setup
- [ ] Install posthog-js
- [ ] Configure environment variables
- [ ] Add PostHog initialization to root layout
- [ ] Add user identification on auth state change
- [ ] Add reset on logout

### Phase 2: Chat Analytics (Priority)
- [ ] Track `chat:message_sent`
- [ ] Track `chat:response_received` with timing
- [ ] Track `chat:event_clicked` with position
- [ ] Track `chat:no_results` for content gaps
- [ ] Track `chat:error` for debugging

### Phase 3: Event Engagement
- [ ] Track `event:saved` and `event:unsaved`
- [ ] Track `event:link_clicked`
- [ ] Track search filter usage

### Phase 4: Auth & Admin
- [ ] Track auth events
- [ ] Track admin import workflow
- [ ] Track admin CRUD operations

### Phase 5: Dashboards
- [ ] Create North Star metrics dashboard
- [ ] Set up chat quality insights
- [ ] Configure retention cohorts
- [ ] Set up funnel analysis

---

## Best Practices

### Do

- **Track backend events for accuracy** - Frontend tracking can be blocked
- **Use consistent naming** - Follow the `category:object_action` convention
- **Include context** - Add relevant properties to understand the full picture
- **Filter internal traffic** - Exclude admin/test users from user metrics
- **Respect privacy** - Never track PII beyond necessary identification

### Don't

- **Don't track everything** - Focus on actionable metrics
- **Don't include PII in properties** - No names, addresses, or sensitive data
- **Don't use email as distinct_id** - Use database user ID instead
- **Don't call identify multiple times** - Once per session is enough
- **Don't track in development** - Use the opt-out in dev mode

### Filtering Internal Traffic

Add a person property to identify internal users:

```typescript
// For admin users
posthog.identify(user.id, {
  is_internal: user.role === 'admin',
})
```

Then filter dashboards to exclude `is_internal = true`.

---

## Privacy Considerations

### GDPR/CCPA Compliance

1. **Cookie consent** - PostHog respects `respect_dnt` setting
2. **Data minimization** - Only track necessary events
3. **Right to deletion** - Use PostHog's person deletion API
4. **Data retention** - Configure retention period in PostHog settings

### Session Recording

If enabled, configure masking:

```typescript
session_recording: {
  maskAllInputs: true,
  maskTextSelector: '[data-sensitive]',
}
```

Add `data-sensitive` to any elements containing personal information.

---

## Resources

- [PostHog React Documentation](https://posthog.com/docs/libraries/react)
- [PostHog Event Tracking Guide](https://posthog.com/tutorials/event-tracking-guide)
- [PostHog Best Practices](https://posthog.com/docs/product-analytics/best-practices)
- [User Identification Guide](https://posthog.com/tutorials/identifying-users-guide)
- [Chatbot Analytics Metrics](https://www.chatbase.co/blog/chatbot-analytics)
