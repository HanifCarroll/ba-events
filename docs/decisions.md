# Architectural Decisions

This document tracks important architectural decisions made during development.

Newest decisions appear first.

## Template

When adding a new decision, use this format:

```
### [Brief Title]

**Date:** YYYY-MM-DD

**Decision:** What was decided

**Alternatives Considered (if applicable):**
- Alternative 1: Why it was rejected
- Alternative 2: Why it was rejected

**Rationale:** Why this approach was chosen
```

---

## Decisions

### Mark Events as Cancelled When Enrichment Encounters 404

**Date:** 2026-01-12

**Decision:** When event enrichment encounters a 404 or 410 HTTP error (event page no longer exists), mark the event as `status: 'cancelled'` for audit purposes instead of just marking enrichment as failed.

**Problem:**
During enrichment, some event pages return 404 errors because:
- The event was cancelled by the organizer
- The event listing expired
- The event page was removed
- The URL structure changed

Previously, these events were marked with `enrichment_status: 'failed'` but kept `status: 'scheduled'`, meaning they would still appear in chat recommendations and the admin would keep retrying enrichment.

**Solution:**
Created `HttpError` class pattern to distinguish HTTP errors from other failures:

```typescript
// src/shared/lib/errors.ts
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string
  ) { ... }

  get isNotFound(): boolean {
    return this.status === 404 || this.status === 410
  }
}
```

Fetch functions (`fetchHtml`, `fetchWithJina`, Eventbrite fetchers) now throw `HttpError` on non-OK responses. The enrichment catch block detects this and marks events as cancelled:

```typescript
catch (error) {
  if (error instanceof HttpError && error.isNotFound) {
    await updateEventEnrichment(client, id, {
      status: 'cancelled',
      enrichment_status: 'failed',
      enrichment_error: `HTTP ${error.status} - Event page not found`,
    })
    return { eventId: id, success: false, enriched: false, cancelled: true }
  }
  // ... existing error handling
}
```

**Why `cancelled` status:**
- The `cancelled` status already existed in the database enum - no migration needed
- Chat agent filters to `status = 'scheduled'` only - cancelled events automatically hidden from users
- Admin UI already has red badge styling for cancelled events
- Preserves audit trail (vs. deleting events entirely)

**Alternatives Considered:**
- **Delete events**: Loses audit trail, makes debugging harder
- **Mark as `past`**: Incorrect semantically - the event didn't happen, it was removed
- **Change return types**: Would require updating many callers; throwing errors is cleaner
- **Retry later**: Events removed from source don't come back; retrying wastes resources

**Rationale:**
1. **Data integrity**: Events aren't lost, just marked as unavailable
2. **User experience**: Cancelled events don't pollute recommendations
3. **Audit trail**: Admin can see which events were cancelled and why
4. **Error class pattern**: Centralizes HTTP error handling, makes 404 detection explicit
5. **Existing infrastructure**: Leverages existing `cancelled` status and UI styling

**Files Created:**
- `src/shared/lib/errors.ts` - HttpError class

**Files Modified:**
- `src/shared/lib/html-parsing.ts` - fetchHtml throws HttpError
- `src/shared/lib/ai/enrichment.ts` - fetchWithJina throws HttpError
- `src/features/import/core/event-enrichment.ts` - Catches HttpError, marks cancelled, tracks stats
- `src/features/import/scrapers/eventbrite/enrichment.ts` - Eventbrite fetchers throw HttpError
- `src/trigger/jobs/enrich-events.ts` - Tracks cancelled count in metadata/logs
- `src/trigger/jobs/enrichment-catchup.ts` - Tracks cancelled count in metadata/logs

---

### Unified Description Enrichment Button

**Date:** 2026-01-11

**Decision:** Consolidate three separate description enrichment buttons (Generic, Passline, Luma) into a single "Add Descriptions" button that automatically routes events to the correct enrichment strategy based on their source.

**Problem:**
The admin events page had three separate enrichment buttons with overlapping but exclusive functionality:
- "Add Descriptions" - For generic sources using Jina Reader + Claude AI
- "Passline Descriptions" - For Passline events using client-side JSON-LD extraction
- "Luma Descriptions" - For Luma events using Playwright scraping

This created UX confusion:
1. Users had to understand which button to use for which events
2. Mixed selections (e.g., 10 Passline + 5 Luma + 5 Meetup) required clicking multiple buttons
3. Three separate buttons cluttered the bulk action bar

**Solution:**
Created `useUnifiedDescriptionEnrichment` hook that:
1. Partitions selected events by source
2. Looks up enrichment strategy using source-to-strategy mapping
3. Executes enrichments sequentially by source (Passline → Luma → Generic)
4. Tracks combined progress across all sources
5. Provides unified stop functionality

**Source-to-Strategy Mapping:**

| Source | Strategy | Hook Used | Stoppable |
|--------|----------|-----------|-----------|
| passline | Client-side JSON-LD | usePasslineDescriptionEnrichment | Yes |
| luma | Playwright scraping | useLumaDescriptionEnrichment | Yes |
| meetup | Jina + Claude | useBackgroundEnrichment | Yes |
| eventbrite | Jina + Claude | useBackgroundEnrichment | Yes |
| ba-tourism | Jina + Claude | useBackgroundEnrichment | Yes |
| csv | None | N/A | N/A |

**Alternatives Considered:**
- **Replace hooks entirely**: Rejected - existing hooks are well-tested and may be needed for source-specific operations
- **Parallel execution**: Rejected - harder to track progress, race conditions in cache invalidation
- **Client-only orchestration**: Rejected - would lose server-side streaming progress

**Rationale:**
1. **Single entry point**: One button handles all description enrichment
2. **Preserves existing logic**: Orchestrates hooks rather than replacing them
3. **Extensible**: New sources just add an entry to the strategy map
4. **Progressive feedback**: Combined progress + source-aware toast messages
5. **Stop all**: Unified stop halts current source and prevents subsequent execution

**Files Created:**
- `src/features/events/hooks/useUnifiedDescriptionEnrichment.ts`
- `src/features/events/hooks/description-enrichment-strategies.ts`

**Files Modified:**
- `src/routes/admin/events/-components/enrichments-config.ts` - Simplified to single description config
- `src/routes/admin/events/index.tsx` - Use unified hook
- `src/features/events/index.ts` - Export new hook

---

### Lazy Initialization for Server-Only SDKs

**Date:** 2026-01-11

**Decision:** Always use lazy initialization (getter function pattern) for server-only SDKs like Anthropic, OpenAI, etc. Never instantiate these at module scope.

**Problem:**
The language dropdown (and all other interactive elements) stopped working because React hydration was failing silently. Investigation revealed:

1. `eventbrite/enrichment.ts` had `const anthropic = new Anthropic()` at module scope
2. When any page imported from `@/features/import`, the barrel file triggered this import
3. The Anthropic SDK detected the browser environment and threw an error
4. This error occurred during JavaScript bundle evaluation, **before React could hydrate**
5. Result: No React event handlers attached, all interactive elements non-functional

**Console error observed:**
```
AnthropicError: It looks like you're running in a browser-like environment
```

**Solution:**
Use lazy initialization pattern - SDK is only instantiated when actually called on the server:

```typescript
// ❌ BAD: Executes immediately when module loads (crashes in browser)
const anthropic = new Anthropic()

// ✅ GOOD: Only instantiates when function is called (on server)
let anthropicClient: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic()
  }
  return anthropicClient
}

// Usage in server functions
const message = await getAnthropicClient().messages.create({ ... })
```

**Pattern already used correctly in:**
- `src/shared/lib/ai/enrichment.ts` (lines 16-23)

**Pattern was incorrect in:**
- `src/features/import/scrapers/eventbrite/enrichment.ts` (fixed)

**Why this happens:**
1. JavaScript bundlers evaluate all imported modules to build the dependency tree
2. Barrel files (`index.ts` with `export * from './module'`) cause transitive imports
3. Even if a module is only used on the server, if it's in the import chain, it gets evaluated
4. Server-only SDKs often detect browser environment and throw errors
5. These errors during bundle evaluation prevent React from completing hydration

**When to apply this pattern:**
- **Always** for: Anthropic SDK, OpenAI SDK, database clients, any SDK that throws in browser
- **Not needed for**: Pure utility functions, types, constants

**Alternatives Considered:**
- `server-only` package: Prevents import entirely, too restrictive if you need the module in shared code
- Dynamic imports: More complex, harder to type correctly
- Separate server-only entry points: Requires restructuring exports

**Rationale:**
1. **Zero runtime cost**: Lazy init adds negligible overhead
2. **No build config changes**: Works with any bundler
3. **Self-contained**: Fix is in the module itself, no external coordination needed
4. **Matches existing pattern**: Already used in `shared/lib/ai/enrichment.ts`

**Detection tips:**
- If React hydration fails silently (no `__reactFiber` on DOM elements), check console for SDK errors
- Search for `new Anthropic()`, `new OpenAI()`, etc. at module scope
- Trace import chains from routes through barrel files

**Files Modified:**
- `src/features/import/scrapers/eventbrite/enrichment.ts` - Changed to lazy initialization

---

### SSR Auth State via Route Context

**Date:** 2026-01-11

**Decision:** Fetch authentication state in the root route's `beforeLoad` hook and pass it to `AuthProvider` via route context, instead of relying solely on client-side `useQuery`.

**Problem:**
The sidebar was showing "Iniciar sesión" (Sign In) even when the user was logged in because:
1. `useQuery` in `AuthProvider` does NOT execute during SSR
2. Server-rendered HTML had `user = null` → sidebar showed login button
3. While `beforeLoad` in protected routes correctly detected auth (redirecting `/login` → `/admin`), this data wasn't shared with React components
4. Client-side query should refetch after hydration, but there was no network request being made

**Investigation:**
- Used Chrome browser automation to verify server-rendered HTML showed login button
- Network inspection confirmed no `getSessionUser` server function call was being made
- Server-side `beforeLoad` correctly detected session (login page redirected to `/admin`)
- The disconnect was between server-side route guards and client-side React state

**Solution:**
Following the [TanStack Start Authentication pattern](https://tanstack.com/start/latest/docs/framework/react/guide/authentication):

1. **Root route fetches session in `beforeLoad`:**
```typescript
// src/routes/__root.tsx
export const Route = createRootRoute({
  beforeLoad: async (): Promise<RootRouteContext> => {
    const session = await getSessionUser()
    return { session }
  },
  // ...
})
```

2. **AuthProvider accepts `initialSession` prop:**
```typescript
// src/shared/providers/AuthProvider.tsx
export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const { data: sessionUser } = useQuery({
    queryKey: ['session'],
    queryFn: () => getSessionUser(),
    initialData: initialSession ?? undefined, // SSR data prevents flash
    staleTime: 1000 * 60 * 5,
  })
  // ...
}
```

3. **Route context passes session to provider:**
```typescript
function RootDocument() {
  const { session } = Route.useRouteContext()
  return (
    // ...
    <AuthProvider initialSession={session}>
      {children}
    </AuthProvider>
  )
}
```

**Alternatives Considered:**
- **React Query SSR with HydrationBoundary**: More complex setup with `dehydrate`/`hydrate`, overkill for single query
- **Client-only with loading skeleton**: Would still show flash of logged-out state
- **Supabase client-side auth only**: Loses SSR benefits, exposes auth state mismatch

**Rationale:**
1. **TanStack Start native pattern**: Uses route context as recommended by docs
2. **Single fetch**: `beforeLoad` runs once on server, data is reused via `initialData`
3. **No hydration mismatch**: Server and client render same auth state
4. **Graceful degradation**: `useQuery` still refetches if needed (window focus, stale data)

**Files Modified:**
- `src/routes/__root.tsx` - Added `beforeLoad`, route context type, pass `initialSession`
- `src/shared/providers/AuthProvider.tsx` - Added `initialSession` prop with `initialData`

**References:**
- [TanStack Start Authentication Guide](https://tanstack.com/start/latest/docs/framework/react/guide/authentication)
- [TanStack Start Basic Auth Example](https://tanstack.com/start/latest/docs/framework/react/examples/start-basic-auth)
- [React Query SSR Guide](https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr)

---

### Unified Enrichment Adapter Pattern

**Date:** 2026-01-11

**Decision:** Create a unified `EnrichmentAdapter` interface separate from the existing `SourceAdapter` to encapsulate source-specific enrichment strategies (client-side vs server-side, extraction methods, language handling).

**Related Decision:** Client-Side Description Extraction for Passline Events (2026-01-11)

**Problem:**
Enrichment logic was scattered across multiple files with source-specific conditionals:
- `useImportWizard.ts` had separate fetch functions per source (e.g., `fetchLumaEventsNeedingEnrichment`, `fetchPasslineEventsNeedingEnrichment`)
- `event-enrichment.ts` had `if (source === 'meetup')` branches
- No central documentation of which sources need client vs server enrichment

**Alternatives Considered:**
- **Extend SourceAdapter**: Rejected - enrichment and import are separate concerns with different lifecycles
- **Configuration object only**: Rejected - source-specific logic still needed encapsulation
- **No adapter, just documentation**: Rejected - code still needs routing logic

**Solution:**
Created `EnrichmentAdapter` interface with:
1. **capabilities**: What the source can enrich (descriptions, venues)
2. **config**: Execution strategy (client/server, language, concurrency)
3. **extractDescriptions/extractVenues**: Client-side extraction (for Cloudflare-blocked sources)
4. **serverEnrich**: Server-side extraction (for Jina-compatible sources)
5. **getEnrichmentUrl**: URL extraction from preview events

**Files Created:**
```
src/features/import/adapters/
├── enrichment-types.ts         # EnrichmentAdapter interface
└── enrichment/
    ├── index.ts                # Registry + helper functions
    ├── passline-enrichment.ts  # Client-side (Cloudflare blocks)
    ├── meetup-enrichment.ts    # Server direct fetch (Jina 451)
    ├── luma-enrichment.ts      # Server-side Jina
    ├── ba-tourism-enrichment.ts # Server-side Jina + AI
    └── eventbrite-enrichment.ts # Server-side Jina + AI
```

**Enrichment Strategy Matrix:**

| Source | Strategy | Reason | Language |
|--------|----------|--------|----------|
| Passline | Client-side | Cloudflare blocks server | Spanish |
| Meetup | Server direct fetch | Jina returns 451 | Detect |
| Luma | Server Jina | Works normally | Detect |
| BA Tourism | Server Jina + AI | Works normally | Spanish |
| Eventbrite | Server Jina + AI | Works normally | Detect |

**Usage:**
```typescript
import { getEnrichmentAdapter, requiresClientSideEnrichment } from '@/features/import/adapters'

const adapter = getEnrichmentAdapter('passline')
if (adapter?.config.requiresClientSide) {
  // Route to client-side extraction
  const results = await adapter.extractDescriptions?.(events, onProgress)
} else {
  // Route to server-side enrichment
  const result = await adapter?.serverEnrich?.(link, { extractVenue: true })
}
```

**Rationale:**
1. **Self-documenting**: Each adapter declares its strategy and reason
2. **Centralized routing**: `getEnrichmentAdapter()` provides single entry point
3. **Type-safe**: TypeScript enforces correct adapter implementation
4. **Extensible**: New sources just add an adapter file
5. **Testable**: Adapters are pure functions with no global state

**Consequences:**
- Existing enrichment code (`useImportWizard.ts`, `event-enrichment.ts`) can gradually migrate to use adapters
- New sources must implement an enrichment adapter
- Decision matrix is documented in both code and `docs/event-import-enrichment.md`

---

### Client-Side Description Extraction for Passline Events

**Date:** 2026-01-11

**Decision:** Implement client-side description extraction for Passline events using JSON-LD, bypassing the server-side Jina Reader flow that fails due to Cloudflare blocking.

**Problem:**
Passline events were imported without descriptions because:
1. The standard enrichment flow uses Jina Reader (`r.jina.ai/{url}`) to fetch page content
2. Jina Reader returns HTTP 200 but gets the wrong content (country selector page instead of event page)
3. Server-side requests to Passline are blocked by Cloudflare
4. Without descriptions, events cannot generate proper embeddings for recommendations

**Investigation:**
- Used Chrome browser automation to check Passline event pages
- Found that **JSON-LD structured data contains full event descriptions**
- Example: Event "TAN BIONICA en Santa Fe" has 1,041-character description in JSON-LD
- JSON-LD is already being extracted client-side for venue information

**Solution:**
1. **Extended `client-enrichment.ts`** to also extract `description` from JSON-LD (alongside venue info)
2. **Created `enrichPasslineDescriptionsAction`** server action that:
   - Takes Spanish descriptions already extracted client-side
   - Translates them to English using Claude
   - Generates embeddings
   - Saves both descriptions to the database
3. **Created `usePasslineDescriptionEnrichment` hook** that:
   - Extracts descriptions client-side via `extractPasslineEventsBatchClient`
   - Sends to server for translation and saving
4. **Updated `enrichSingleEvent`** to skip Passline events (they require client-side extraction)

**Files Created/Modified:**
- `src/features/import/scrapers/passline/client-enrichment.ts` - Added description extraction
- `src/features/events/api/enrichment.ts` - Added `enrichPasslineDescriptionsAction`, skip Passline in `enrichSingleEvent`
- `src/features/events/hooks/usePasslineDescriptionEnrichment.ts` - New hook for client-side flow
- `src/features/events/index.ts` - Exported new functions
- `src/features/import/index.ts` - Exported new types

**Usage:**
To enrich Passline events with descriptions:
1. Go to Admin > Events
2. Select Passline events with enrichment_status = 'pending'
3. Click "Fetch Passline Descriptions" (once UI button is added)

**Consequences:**
- Passline description enrichment requires user action (client-side extraction)
- The "Add Descriptions" button will skip Passline events (shows message to use Passline-specific button)
- Descriptions are in Spanish, translated to English via Claude API

**Related Decision:** Disable Scheduled Passline Scraper (2026-01-11)

---

### Disable Scheduled Passline Scraper (Cloudflare Blocking)

**Date:** 2026-01-11

**Decision:** Remove Passline from the daily automated scrape job. Passline imports must now be done manually via the admin UI.

**Problem:**
Passline implemented aggressive Cloudflare bot protection that blocks all server-side requests:
- Direct API calls return **HTTP 403 Forbidden**
- Browserless.io with stealth mode: blocked
- Browserless.io with residential proxy: blocked
- Network interception approach: blocked
- All configurations show "Un momento..." / "Just a moment..." Cloudflare challenge page

The scheduled Trigger.dev job (`scrape-passline`) has failed for multiple consecutive days.

**Testing Performed:**
Created test scripts to evaluate multiple bypass approaches:
1. `test-passline-browserless-api.ts` - Execute fetch inside Browserless browser context → CORS error
2. `test-passline-browserless-scrape.ts` - Scrape website directly → Cloudflare blocked
3. `test-passline-network-intercept.ts` - Intercept API calls during page load → Cloudflare blocked
4. `test-passline-browserless-proxy.ts` - Try stealth, proxy, default configs → All blocked

**Alternatives Considered:**
- **Specialized Cloudflare bypass services** (ScrapingBee, ZenRows, Bright Data): Would add cost and may still fail as Cloudflare updates
- **Keep retrying with Browserless**: Wastes resources, consistently fails
- **Contact Passline for API access**: Uncertain timeline, may not be granted

**Solution:**
1. Removed `scrape-passline` from `daily-scrape.ts` orchestrator
2. Passline import wizard in admin UI still works (runs in real browser context)
3. Added comments in code explaining why Passline is excluded

**Files Modified:**
- `src/trigger/jobs/daily-scrape.ts` - Removed Passline from SOURCE_JOBS and trigger calls

**Consequences:**
- Passline events must be imported manually by an admin
- Manual imports work because they run in the user's actual browser
- If Passline relaxes their Cloudflare rules in the future, the job can be re-enabled

**Related Decision:** Client-Side Fetch for Passline Scraper (2025-12-29)

---

### Handle Hidden Event Addresses (Luma Placeholder Detection)

**Date:** 2026-01-11

**Decision:** Detect placeholder venue text like "Register to See Address" during import, prevent fake venue creation, and display a user-friendly message indicating registration is required to see the address.

**Problem:**
Luma events can have hidden addresses that show "Register to See Address" instead of actual location. Previously:
- This placeholder text was treated as a real venue name
- A fake venue record got created in the database
- Events got linked to this fake venue, polluting venue data

**Solution:**
1. Add `location_hidden` boolean column to events table (default `false`)
2. Add `isPlaceholderVenue()` function to detect patterns like "Register to See Address", "TBA", "TBD", etc.
3. Update venue settlement to return `action: 'placeholder'` when detected
4. Update Luma imports (both manual wizard and Trigger.dev job) to set `location_hidden: true`
5. Update EventCard UI to show "Address after registration" with a registration link
6. Hide the map button in EventActions when `location_hidden` is true

**Alternatives Considered:**
- Store the placeholder text as venue name: Pollutes venue data with fake entries
- Skip importing these events entirely: Loses valuable events just because address is hidden
- Show generic "No address" message: Less helpful than explaining registration is required

**Rationale:**
1. **Data integrity**: Prevents fake venues from being created
2. **User clarity**: Users understand they need to register to see the address
3. **Actionable**: Registration link provides a clear path forward
4. **Industry standard**: Matches how Luma, Partiful, and other platforms handle this pattern

**Placeholder Patterns Detected:**
```typescript
const PLACEHOLDER_PATTERNS = [
  /register\s*(to\s*)?see\s*address/i,
  /address\s*(to\s*be\s*)?(confirmed|tba|tbd)/i,
  /location\s*(to\s*be\s*)?(confirmed|tba|tbd|announced)/i,
  /^tba$/i,
  /^tbd$/i,
  /^to\s*be\s*(announced|confirmed|determined)$/i,
]
```

**Files Modified:**
- `supabase/migrations/20260111123144_add_location_hidden.sql` - Database column
- `src/features/import/core/venue-settlement.ts` - Placeholder detection
- `src/features/import/core/luma.ts` - Trigger.dev job
- `src/features/import/api/luma.ts` - Manual import
- `src/routes/-components/events/EventCard.tsx` - UI display
- `src/routes/-components/events/EventActions.tsx` - Hide map button
- `src/shared/lib/types.ts` - TypeScript types

---

### Client-Side Pagination for Admin Events Table

**Date:** 2026-01-10

**Decision:** Load all events in the route loader and perform filtering, sorting, and pagination client-side instead of using server-side pagination.

**Previous Approach:**
- Server-side pagination via `useEventsPaginated` hook with React Query
- Route loader only fetched venues; events fetched client-side via `useQuery`
- Caused loading flash: empty state → filters → data (3 render phases)

**New Approach:**
```typescript
// Route loader fetches ALL data upfront
loader: async () => {
  const [venues, allEvents] = await Promise.all([
    listVenues(),
    listAllEventsAdmin(), // Fetches up to 5000 events
  ])
  return { venues, allEvents }
}

// Component filters/paginates client-side with useMemo
const filteredEvents = useMemo(() => filterEvents(allEvents, searchParams), [allEvents, searchParams])
const sortedEvents = useMemo(() => sortEvents(filteredEvents, sortBy, sortDir), [filteredEvents, sortBy, sortDir])
const events = sortedEvents.slice((page - 1) * pageSize, page * pageSize)
```

**Alternatives Considered:**
- Server-side pagination with `initialData`: Still caused multiple render phases due to separate tab counts query
- SSR hydration with React Query: Complex setup with dehydration/hydration, overkill for admin page
- Loading skeleton: Would hide the flash but data still loads in phases

**Rationale:**
1. **Instant rendering**: All data available on first render, no loading flash
2. **Instant interactions**: Tab switching, filtering, pagination are immediate (no network)
3. **Simplicity**: Removed complex `useEventsPaginated` hook with server-side queries
4. **Appropriate for dataset size**: ~500-2000 events is well within client-side handling capacity
5. **URL state preserved**: Filters/pagination still use URL search params for shareability

**Trade-offs:**
- ✅ No loading flash or intermediate states
- ✅ Instant filtering, sorting, pagination
- ✅ Simpler code (no React Query for events)
- ✅ Reduced server requests
- ❌ Initial page load fetches more data (~100KB for 1000 events)
- ❌ Memory usage higher on client (all events in memory)
- ❌ Not suitable if dataset grows to 10,000+ events

**When to use this pattern:**
- Dataset under ~5000 records
- Frequent filtering/pagination expected
- Loading flash is unacceptable UX
- Admin/internal tools where initial load time is acceptable

**When NOT to use:**
- Large datasets (10,000+ records)
- Public-facing pages where initial payload size matters
- Data changes frequently and needs real-time server state

---

### React State for Edit Modals (Performance Fix)

**Date:** 2025-01-10

**Related Decision:** Instant Edit Modal Pattern for Admin (2025-01-10)

**Decision:** Switch edit modal state from URL search params (`?editId=<id>`) to local React state (`useState`) for instant open/close performance.

**Problem:**
Even with `loaderDeps: () => ({})`, TanStack Router still treats search param changes as full navigations that go through the routing lifecycle. This caused a noticeable ~1 second delay when opening/closing edit modals due to:
1. Router navigation processing
2. Route component re-renders triggered by search param changes
3. React Query dependency recalculations (even when query keys don't change, new object references are created)

**Solution:**
```typescript
// Before: URL-based (slow)
const editingEvent = useMemo(
  () => searchParams.editId ? events.find(e => e.id === searchParams.editId) : null,
  [events, searchParams.editId]
)
const handleEdit = (event) => navigate({ search: prev => ({ ...prev, editId: event.id }) })

// After: React state (instant)
const [editingEvent, setEditingEvent] = useState<EventWithVenue | null>(null)
const handleEdit = (event) => setEditingEvent(event)
```

**Additional optimization:** Only mount the modal component when needed:
```typescript
// Before: Always mounted, controlled by prop
<EditEventSheet event={editingEvent} onClose={handleCloseEdit} />

// After: Conditionally mounted
{editingEvent && <EditEventSheet event={editingEvent} onClose={handleCloseEdit} />}
```

**Trade-offs:**
- ❌ No shareable link to specific event edit (`/admin/events?editId=xyz`)
- ❌ No browser back button to close modal
- ✅ Instant open/close (pure React state update, no router involvement)
- ✅ Simpler code (no URL schema, no navigation calls)
- ✅ Reduced re-renders (state change is local, not global route change)

**Rationale:** For admin edit modals, instant UX is more important than URL sharing. Users rarely share links to "edit this specific event" - they share the admin page itself. The performance improvement is immediately noticeable.

**Applied to:**
- Events: `EditEventSheet` - uses `useState<EventWithVenue | null>`
- Venues: `EditVenueDialog` - uses `useState<Venue | null>`

---

### Instant Edit Modal Pattern for Admin

**Date:** 2025-01-10

**Decision:** Use modal-based editing with URL search param sync (`?editId=<id>`) instead of page navigation for admin entity editing. Applied to both events (Sheet) and venues (Dialog).

**Pattern:**
```typescript
// 1. Add editId to URL search schema
const eventSearchSchema = z.object({
  // ... other params
  editId: z.string().optional(),
})

// 2. Derive editing state from cached data (instant!)
const editingEvent = useMemo(
  () => searchParams.editId ? events.find(e => e.id === searchParams.editId) ?? null : null,
  [events, searchParams.editId]
)

// 3. Open/close via URL navigation
const handleEdit = (event) => navigate({ search: prev => ({ ...prev, editId: event.id }) })
const handleCloseEdit = () => navigate({ search: prev => ({ ...prev, editId: undefined }) })

// 4. Sheet/Dialog controlled by null check
<EditEventSheet event={editingEvent} onClose={handleCloseEdit} />
```

**Alternatives Considered:**
- Keep page navigation (`/admin/events/$id`): Slow, server-side loading breaks flow
- Route masking (TanStack Router feature): More complex, overkill for this use case
- Client-side state only (`useState`): Loses URL sharing and browser back button

**Rationale:**
1. **Instant UX**: Modal opens immediately using cached data from table (no server round-trip)
2. **URL sync**: Shareable links (`/admin/events?editId=abc`), browser back button closes modal
3. **Consistent pattern**: Matches existing `EditVenueDialog` approach in venues admin
4. **Simple implementation**: Search params recommended by TanStack Router maintainer

**Applied to:**
- Events: `EditEventSheet` (`src/routes/admin/events/-components/EditEventSheet.tsx`)
- Venues: `EditVenueDialog` (`src/routes/admin/venues/-components/EditVenueDialog.tsx`)

**Performance Optimization - loaderDeps:**

By default, TanStack Router's stale-while-revalidate behavior causes route loaders to re-run in the background when search params change. This caused a ~2 second delay when opening/closing edit modals because the loader would refetch all venues from Supabase.

**Fix:** Use `loaderDeps: () => ({})` to tell the router the loader doesn't depend on any search params:

```typescript
export const Route = createFileRoute('/admin/venues/')({
  validateSearch: venueSearchSchema,
  // Loader doesn't depend on any search params - prevents reload on editId change
  loaderDeps: () => ({}),
  loader: async () => listVenues(),
  component: VenueListPage,
})
```

**How it works:**
- `loaderDeps` specifies which search params should trigger loader re-runs
- Returning `{}` means "no dependencies" - loader only runs on initial page load
- Changing `editId` (or any search param) won't trigger a reload
- If your loader DOES depend on search params (e.g., pagination), include them: `loaderDeps: ({ search }) => ({ page: search.page })`

**References:**
- TanStack Router recommendation: https://github.com/TanStack/router/discussions/1966
- TanStack Router Data Loading: https://tanstack.com/router/v1/docs/framework/react/guide/data-loading

---

### URL-Based State Management for Admin Filters

**Date:** 2025-01-09

**Decision:** Use URL search params as the single source of truth for all filter, pagination, and tab state in the admin events table. Implemented using TanStack Router's type-safe search params with Zod validation.

**Pattern:**
```typescript
// 1. Define Zod schema with defaults
const eventSearchSchema = z.object({
  tab: z.enum(['all', 'needs_attention', 'pending_review', 'past']).optional().catch('all'),
  page: z.number().optional().catch(1),
  search: z.string().optional(),
  showPast: z.boolean().optional().catch(false),
  // ... other filters
})

// 2. Route validates search params
export const Route = createFileRoute('/admin/events/')({
  validateSearch: eventSearchSchema,
})

// 3. Hook provides typed setters that update URL
const { filters, setShowPast, setSearch } = useEventsPaginated({
  searchParams: Route.useSearch(),
  navigate: Route.useNavigate(),
})

// 4. Setters update URL, which triggers re-render with new params
const setShowPast = (value: boolean) => {
  navigate({
    search: (prev) => ({ ...prev, showPast: value || undefined, page: 1 }),
  })
}
```

**Alternatives Considered:**
- React state (`useState`/`useReducer`): Loses state on refresh, can't share URLs
- Global state (Zustand/Redux): Adds complexity, still loses state on refresh
- localStorage persistence: Complex sync logic, can't share URLs with others

**Rationale:**
1. **Shareable URLs**: Users can bookmark or share exact filter combinations (e.g., `/admin/events?tab=needs_attention&missingDescription=true`)
2. **Browser history works**: Back/forward buttons navigate through filter states
3. **Refresh preserves state**: No lost work when refreshing the page
4. **Type safety**: Zod schema validates params, `.catch()` provides defaults for invalid values
5. **Single source of truth**: No sync bugs between URL and component state
6. **Deferred defaults**: Using `.catch()` instead of `.default()` means invalid params get defaults without URL changes

**Consequences:**
- New filters must be added to both Zod schema and `useEventsPaginated` hook
- Filter setters should reset `page: 1` when changing filters (avoids empty page edge cases)
- Boolean filters use `value || undefined` pattern to keep URLs clean (false = omitted from URL)
- The hook converts URL param names to API param names (e.g., `venue` → `venueId`)

---

### Serverless-Compatible Scraping Strategy

**Date:** 2025-01-09

**Related Decision:** Playwright for Browser-Based Scrapers (2025-12-29)

**Decision:** When scraping web content, choose the approach based on execution context:

| Context | Approach | Why |
|---------|----------|-----|
| **Netlify Server Functions** (`src/features/*/api/`) | Fetch + HTML parsing, OR Browserless.io | Netlify has no Playwright binaries |
| **Trigger.dev Jobs** (`src/trigger/jobs/`) | Playwright (local) | Jobs run in containers with full browser support |
| **Client-side** | Fetch (if CORS allows) | Browser handles requests directly |

**Key Rule:** Never use `chromium.launch()` in server functions under `src/features/*/api/`. These run on Netlify serverless which lacks Playwright browser binaries.

**Alternatives Considered:**
- Bundle Playwright browsers: Rejected - 100MB+ bundle size, exceeds Netlify limits
- Always use Browserless.io: Acceptable fallback but adds cost and latency
- Move all scraping to Trigger.dev: Best for long-running operations

**Rationale:**
1. Netlify serverless has 10-26 second timeout AND no Playwright binaries
2. JSON-LD and `__NEXT_DATA__` are in initial HTML, making Playwright unnecessary for many extractions
3. Trigger.dev jobs have 30+ minute timeouts and full container environments

**Consequences:**
- Before adding Playwright to any `api/` file, consider if fetch + parsing suffices
- For JS-rendered content in server functions, use Browserless.io as fallback
- Document any new Playwright usage in server functions as tech debt

---

### Vertical Slice Architecture Restructuring

**Date:** 2025-12-31

**Decision:** Restructure the codebase from technical-type organization to a Vertical Slice architecture with:
1. `features/` directory for business logic modules (events, venues, import, chat, auth)
2. `shared/` directory for truly shared code (UI components, database, utilities)
3. Route colocation using TanStack Router's `-components/` pattern for route-specific UI

**Alternatives Considered:**
- Feature-Sliced Design (FSD): 7-layer architecture with strict dependency rules - too rigid for this project size, adds complexity with layers like "entities" and "widgets" that would be overkill
- Features in routes: Embedding all feature code directly in route folders - rejected because business logic (hooks, API functions) is often shared across multiple routes
- Continue with current structure: Technical-type organization (`components/`, `hooks/`, `lib/`) was becoming hard to navigate as the codebase grew

**Rationale:**
1. **Maintainability focus**: Everything for a feature is in one place - no more hunting across `components/`, `hooks/`, `lib/` for related code
2. **Clear public APIs**: Each feature has an `index.ts` that exports only what's needed, reducing coupling
3. **Route colocation**: Using `-components/` folders keeps route-specific UI close to routes while keeping routes thin
4. **Shared code discipline**: Only code used by 3+ features goes in `shared/`, preventing premature abstraction
5. **TanStack Router native**: Uses the `-prefix` convention for files/folders the router should ignore

**Structure:**
```
src/
├── features/           # Feature modules with business logic
│   ├── events/         # Event management
│   │   ├── api/        # Server functions
│   │   └── hooks/      # React hooks
│   ├── venues/         # Venue management
│   ├── import/         # Import wizard
│   ├── chat/           # Chat/AI feature
│   └── auth/           # Authentication
├── shared/             # Truly shared code
│   ├── ui/             # shadcn + custom UI
│   ├── lib/            # Utils, DB, types
│   └── providers/      # Context providers
└── routes/             # Thin route files
    └── admin/events/
        ├── index.tsx   # Route (composition only)
        └── -components/ # Route-specific UI
```

**References:**
- [TanStack Router File-Based Routing](https://tanstack.com/router/v1/docs/framework/react/routing/file-based-routing)
- [Tips from 8 months of TanStack/Router in production](https://swizec.com/blog/tips-from-8-months-of-tan-stack-router-in-production/)
- [Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/)

---

### Node.js Module Polyfills for Vite Client Build

**Date:** 2025-12-31

**Decision:** Use Vite resolve aliases to polyfill/stub Node.js modules (`node:stream`, `node:stream/web`, `node:async_hooks`) that leak into the client bundle from TanStack packages.

**Alternatives Considered:**
- Specific import paths (e.g., `@tanstack/start-client-core/createServerFn`): Package doesn't export individual modules; barrel exports pull in SSR code regardless
- Using `serverOnly()` directive and dedicated server-only files: Investigated but the import chain is in TanStack packages themselves, not our code
- Waiting for upstream fix: GitHub issues #4022 and #6185 addressed different aspects; the barrel export issue persists in v1.144+
- Netlify plugin configuration: Plugin is a thin wrapper with no special handling for Node.js module externalization

**Rationale:**
1. **Root cause**: TanStack Start's barrel exports (`export * from "@tanstack/start-client-core"`) defeat tree-shaking. Even though packages have separate `./ssr/server` and `./ssr/client` exports, the main exports pull in modules that import `node:stream`.
2. **Import chain traced**:
   - `@tanstack/react-start` → `@tanstack/start-client-core`
   - `@tanstack/start-client-core/index.js` → imports from `@tanstack/router-core/ssr/client`
   - `createServerFn.js` → imports `mergeHeaders` from `@tanstack/router-core/ssr/client`
   - Chain eventually reaches `transformStreamWithRouter.js` which imports `{ Readable } from "node:stream"`
3. **Polyfill solution**: `stream-browserify` and `web-streams-polyfill` provide browser-compatible implementations. Custom stub for `async_hooks` provides no-op implementations.
4. **Pragmatic choice**: Polyfills add ~15KB gzipped but work reliably. The alternative is waiting for TanStack to restructure their exports, which may not happen.

---

### Client-Side Chunked Batching for Meetup Scraper

**Date:** 2025-12-31

**Decision:** Chunk Meetup date ranges into 7-day batches on the client side to avoid HTTP request timeouts when scraping large date ranges.

**Alternatives Considered:**
- Background jobs: Would require additional infrastructure (job queue, worker processes), harder to show real-time progress
- Streaming responses: Complex to implement, TanStack server functions don't support streaming well
- Increasing server timeout: Doesn't address root cause, just delays the problem

**Rationale:**
1. **Root cause**: HTTP request timeouts (~60-120s) kill long-running requests before Meetup scraping completes. A 31-day range takes ~4 minutes.
2. **7-day chunks**: Each batch completes in ~30-40 seconds, well under timeout limits
3. **Progress UI**: Users see "Batch 2/5 (35 events)" - better UX than a spinner for 4 minutes
4. **Error resilience**: If one batch fails, we show partial results + continue with other batches
5. **Deduplication**: Events appearing in multiple batches are deduped by `meetup.id`
6. **No infrastructure changes**: Works with existing serverless architecture

---

### Remove RELEVANT Event Filtering from Chat Agent

**Date:** 2025-12-31

**Decision:** Remove the `RELEVANT:["id1","id2"]` marker system that filtered which events to display. Now all search results are shown directly without Claude-based filtering.

**Related Decision:** Single-Search with Relevance Filtering for Chat Agent (2025-12-30)

**Alternatives Considered:**
- Keep RELEVANT filtering with stricter prompting: Still prone to text/card mismatches
- Filter BEFORE response (two-step): Adds latency and complexity for marginal benefit

**Rationale:**
1. **Text/card mismatch**: Claude would describe N events in text but mark fewer as "relevant", causing UI to show fewer cards than described
2. **Complexity**: The filtering added parsing logic, regex matching, and failure modes
3. **Search quality is sufficient**: Semantic search with filters returns relevant results; second-layer AI filtering added complexity without proportionate benefit

---

### Single-Search with Relevance Filtering for Chat Agent

**Date:** 2025-12-30

**Decision:** Replace the agentic loop (up to 5 iterations) with a single-search model where Claude makes ONE tool call per message, filters results for relevance, and refinement suggestions help users iterate.

**Alternatives Considered:**
- Keep agentic loop with better sync: Complex to fix text/events mismatch when Claude retries
- Show all semantic search results: Overwhelms users with loosely related events
- Stricter similarity threshold in database: Less flexible, Claude can't apply contextual filtering

**Rationale:**
1. **Text/events mismatch**: The agentic loop caused Claude's text to describe different events than what was displayed (events sent immediately on tool execution, but Claude might retry and describe different results)
2. **Relevance filtering**: Semantic search returns loosely related results. Having Claude explicitly specify which events are relevant (via `RELEVANT:["id1","id2"]` marker) ensures only contextually appropriate events are shown
3. **User-driven refinement**: Instead of AI guessing how to refine searches, suggestion chips let users drive iteration (augment mode for results found, replace mode for zero results)
4. **UX research**: Industry best practice is "fewer, more relevant results" over showing everything

---

### 4-Hour Default Duration for Events Without End Times

**Date:** 2025-12-30

**Decision:** Mark events as "past" 4 hours after their start time if they have no end time specified.

**Alternatives Considered:**
- Wait until next calendar day: Too conservative - a 9pm event would still show until midnight
- Hide immediately when start time passes: Too aggressive - users might still want to discover ongoing events
- 2-hour default: Too short for concerts and club nights typical in Buenos Aires

**Rationale:** Research into event platforms (Eventbrite, Meetup, The Events Calendar) showed varying approaches. For Buenos Aires nightlife/events, 4 hours balances discoverability with relevance: concerts (2-4 hrs), club nights (4-6+ hrs), cultural events (1-3 hrs). A concert at 9pm hides by 1am; a club night at 11pm hides by 3am.

---

### Unified Collapsible Sidebar Navigation

**Date:** 2025-12-29

**Decision:** Replace header bar with a collapsible sidebar for both admin and main navigation.

**Rationale:** Sidebar provides more room for navigation items, collapses for more content space, and unifies the admin/user experience. Mobile uses hamburger menu on left side. Other AI apps follow this pattern.

---

### Playwright for Browser-Based Scrapers

**Date:** 2025-12-29

**Decision:** Use Playwright for scrapers that need JavaScript rendering (BA Tourism, Meetup venue enrichment).

**Alternatives Considered:**
- Puppeteer: Similar capabilities but Playwright has better API and cross-browser support
- Simple HTTP scraping: Doesn't work for JS-rendered content

**Rationale:** BA Tourism and Meetup pages require JavaScript execution. Playwright provides reliable browser automation with good TypeScript support and headless mode.

---

### Native HTML Table for DataTable

**Date:** 2025-12-29

**Decision:** Refactor DataTable to use native HTML table with sticky header instead of TanStack Virtual.

**Alternatives Considered:**
- TanStack Virtual: Good for huge lists but added complexity for header/body scroll sync
- CSS Grid layout: Harder to maintain table semantics

**Rationale:** Native HTML tables handle scroll sync naturally. Sticky header with `position: sticky` is simpler and works well. Virtualization still used for the table body rows.

---

### Two-Phase Import Pattern

**Date:** 2025-12-29

**Decision:** Implement a two-phase import: fast initial import, then on-demand enrichment.

**Alternatives Considered:**
- Full enrichment during import: Too slow, blocks user
- Background job queue: Added complexity, harder to debug

**Rationale:** Users want to see events quickly. Enrichment (descriptions, prices, categories) can happen later without blocking the import flow. Non-blocking background enrichment with progress toasts provides good UX.

---

### Bilingual Event Descriptions (Spanish/English)

**Date:** 2025-12-29

**Decision:** Store both Spanish and English descriptions for events (`description_es`, `description_en`).

**Alternatives Considered:**
- Single description field with on-demand translation: Slower, repeated API costs
- English-only: Loses authenticity, harder for Spanish speakers

**Rationale:** Spanish descriptions are authentic and better for embeddings (cross-lingual model handles queries in either language). English translations help English-speaking users understand event details.

---

### React Query + React Hook Form Infrastructure

**Date:** 2025-12-29

**Decision:** Add React Query for data fetching and React Hook Form with Zod for form handling.

**Alternatives Considered:**
- TanStack Router loaders only: Less control over cache invalidation and mutations
- Custom form state: More boilerplate, no validation integration

**Rationale:** React Query provides cache invalidation, optimistic updates, and mutation hooks. React Hook Form with Zod gives type-safe validation and reduces form boilerplate. Both integrate well with TanStack ecosystem.

---

### SECURITY DEFINER is_admin() Function

**Date:** 2025-12-29

**Decision:** Use a `SECURITY DEFINER` function for admin role checking to avoid RLS infinite recursion.

**Alternatives Considered:**
- Direct RLS policy on profiles table: Caused infinite recursion when checking admin status
- Separate admin table: Added complexity and sync issues

**Rationale:** RLS policies that reference the same table they protect can cause infinite loops. A `SECURITY DEFINER` function runs with elevated privileges, bypassing the recursion issue.

---

### Client-Side Fetch for Passline Scraper

**Date:** 2025-12-29

**Decision:** Move Passline API fetching to client-side instead of server-side.

**Alternatives Considered:**
- Server-side fetch with browser headers: Still blocked by Cloudflare
- Proxy server: Added infrastructure complexity and cost

**Rationale:** Cloudflare was blocking server-side requests even with browser headers. Client-side fetch from user's browser bypasses these blocks since it's a real browser request.

---

### Rate Limiting with Upstash Redis

**Date:** 2025-12-28

**Decision:** Use Upstash Redis for API rate limiting.

**Alternatives Considered:**
- In-memory rate limiting: Doesn't work across serverless instances
- Supabase-based: Added latency, not purpose-built for rate limiting

**Rationale:** Upstash provides serverless Redis with a generous free tier. Works across serverless function instances and has a simple rate limiting SDK.

---

### "Noche Porteña" Design Aesthetic

**Date:** 2025-12-28

**Decision:** Use a warm noir aesthetic inspired by Buenos Aires nightlife for the UI.

**Alternatives Considered:**
- Standard shadcn dark theme: Generic, not memorable
- Bright/colorful theme: Doesn't match the nightlife/events vibe

**Rationale:** The warm amber accents on dark backgrounds evoke Buenos Aires tango halls and nightlife. Creates a distinctive brand identity that matches the product's purpose.

---

### Semantic Search with pgvector (Lower Threshold)

**Date:** 2025-12-28

**Decision:** Use pgvector for semantic search with a lower similarity threshold (~0.3) for short queries.

**Alternatives Considered:**
- Higher threshold (0.7+): Too restrictive, missed relevant results
- Separate short/long query handling: Added complexity

**Rationale:** Short queries like "romantic evening" naturally have lower similarity scores against full event descriptions. The cross-lingual embedding model handles Spanish content well with English queries.

---

### TanStack Start over Next.js

**Date:** 2025-12-28

**Decision:** Use TanStack Start as the framework instead of Next.js.

**Alternatives Considered:**
- Next.js: More mature ecosystem, but heavier, React Server Components complexity, Vercel-centric deployment

**Rationale:** TanStack Start provides a lighter, more flexible foundation with native integration with TanStack Router and Query. Better suited for a single-page app experience with server functions.

---

