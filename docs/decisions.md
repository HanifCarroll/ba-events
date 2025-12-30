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

