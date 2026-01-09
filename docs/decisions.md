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

