# BA Events - Project Guidelines

## Runtime

Always use **Bun** instead of Node.js, npm, pnpm, or yarn.

```bash
bun install          # Install dependencies
bun run dev          # Start dev server (port 3001)
bun run build        # Production build
bun run preview      # Preview production build
bun test             # Run tests
```

Bun automatically loads `.env` files - don't use dotenv.

**Important:** Never start the dev server yourself. The user will always have it running.

## Supabase CLI

Use `bunx supabase` for all Supabase CLI commands (no global install needed):

```bash
bunx supabase db push           # Apply migrations to remote database
bunx supabase db push --dry-run # Preview migrations without applying
bunx supabase migration new     # Create a new migration file
bunx supabase gen types         # Generate TypeScript types from schema
```

## Framework

This is a **TanStack Start** project with:
- TanStack Router (file-based routing in `src/routes/`)
- TanStack Query for data fetching
- React 19
- Vite + Nitro
- Tailwind CSS v4

## Architecture

This project uses **Vertical Slice Architecture** - code is organized by feature rather than technical layer.

### Key Principles

1. **Features own their logic** - Each feature (`auth`, `chat`, `events`, `import`) contains its own API functions, hooks, and types
2. **Shared code is truly shared** - Only code used by multiple features goes in `shared/`
3. **Routes are thin** - Route files handle routing logic only; UI components live in `-components/` folders
4. **Direct imports only** - Import from specific files, not barrel `index.ts` files (improves tree-shaking)

### Path Aliases

```typescript
// ✅ CORRECT - Direct file imports
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'
import { getTrendingEventsAction } from '@/features/events/api/crud'
import { Button } from '@/shared/ui/button'

// ❌ WRONG - Barrel imports (hurts tree-shaking)
import { useAuthContext, signOutAction } from '@/features/auth'
```

### Project Structure

```
src/
├── features/                    # Feature modules (business logic)
│   ├── auth/                    # Authentication
│   │   ├── api/                 # Server functions
│   │   │   ├── client.ts        # Browser-side Supabase auth
│   │   │   ├── session.ts       # Server session management
│   │   │   └── rate-limit.ts    # Upstash Redis rate limiting
│   │   └── hooks/               # React hooks
│   ├── chat/                    # AI chat feature
│   │   ├── api/                 # Concierge agent, streaming, tools, prompts
│   │   └── lib/                 # Message utilities
│   ├── events/                  # Event data (public server functions, presentation)
│   │   ├── api/                 # getTrendingEventsAction, getEventWithVenueAction
│   │   └── lib/                 # Description/source presentation helpers
│   └── import/                  # Event scrapers + duplicate detection
│       ├── api/                 # Source handlers (passline, eventbrite, etc.)
│       ├── core/                # Duplicate detection, venue settlement
│       └── scrapers/            # Web scrapers (run via src/trigger jobs)
│
├── shared/                      # Truly shared code
│   ├── ui/                      # shadcn/ui + custom components
│   ├── lib/                     # Utilities
│   │   ├── ai/                  # Embeddings, enrichment helpers
│   │   ├── db/                  # Supabase client (getSupabase + queries)
│   │   ├── utils/               # Helpers (cn, formatting)
│   │   ├── api-response.ts      # API response utilities
│   │   ├── schemas.ts           # Zod validation
│   │   ├── types.ts             # TypeScript types
│   │   ├── query.ts             # React Query keys & setup
│   │   └── analytics.ts         # PostHog tracking
│   ├── hooks/                   # Shared hooks
│   └── providers/               # Context providers
│       └── AuthProvider.tsx     # Auth context
│
├── routes/                      # TanStack Router pages (thin)
│   ├── __root.tsx               # Root layout with providers
│   ├── -components/             # Route-specific components
│   │   ├── chat/                # Chat UI components
│   │   └── events/              # Event display components
│   ├── index.tsx                # Home (chat + trending grid)
│   ├── chat_.$conversationId.tsx # Conversation view
│   ├── saved.tsx / profile.tsx  # Signed-in pages
│   ├── login.tsx / register.tsx # Auth (register redirects to login)
│   ├── events/$id.tsx           # Public event detail
│   ├── auth/callback.tsx        # OAuth callback
│   └── api/
│       ├── chat.ts              # Concierge streaming endpoint
│       └── events.ts            # External API endpoint
│
├── trigger/                     # Trigger.dev background jobs (scraping, enrichment)
├── paraglide/                   # i18n (auto-generated, gitignored)
├── styles.css                   # Global styles
…

messages/                        # i18n translation files
├── en.json
└── es.json

supabase/                        # Database
├── schema.sql                   # Full schema
├── seed.sql                     # Sample data
└── migrations/                  # SQL migrations

docs/                            # Documentation
├── decisions.md                 # Architectural decisions
├── event-import-enrichment.md   # Import & enrichment guide
└── prd.md                       # Product requirements
```

### Route Colocation Pattern

Routes use TanStack Router's `-components/` naming convention:

```
src/routes/admin/events/
├── index.tsx              # Route file (thin)
├── $id.tsx                # Dynamic route
└── -components/           # Route-specific UI (ignored by router)
    ├── EventForm.tsx
    ├── EventTable.tsx
    └── import/
        ├── SourceStep.tsx
        └── ConfigureStep.tsx
```

The `-` prefix tells TanStack Router to ignore these folders when generating routes.

## Routing

Routes are in `src/routes/`. The route tree is auto-generated in `src/routeTree.gen.ts`.

Create new routes by adding files to `src/routes/`. Dynamic routes use `$param` syntax:
- `src/routes/admin/events/$id.tsx` → `/admin/events/:id`

## Server Functions

Use TanStack Start server functions for API calls:

```tsx
import { createServerFn } from '@tanstack/react-start'

// Simple server function (no input)
const getEvents = createServerFn({ method: 'GET' }).handler(async () => {
  return db.query('SELECT * FROM events')
})

// Server function with input validation (use validator)
const createEvent = createServerFn({ method: 'POST' })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    return db.insert('events', data)
  })
```

### Server Function Pattern

Public server functions are unauthenticated; any user-scoped operations run
through `getSessionUser()` from `@/features/auth/api/session`:

```tsx
import { createServerFn } from '@tanstack/react-start'
import { getSessionUser } from '@/features/auth/api/session'

export const createEventAction = createServerFn({ method: 'POST' })
  .inputValidator((data: EventInsert) => data)
  .handler(async ({ data }) => {
    const user = await getSessionUser()
    // ...
    return createEvent(data)
  })
```

## UI Components

**Always use shadcn/ui components** for UI elements. If a component isn't installed, add it:

```bash
bunx shadcn@latest add button
bunx shadcn@latest add input
```

Components are installed to `src/shared/ui/`.

Before building custom UI, check if shadcn has a component: https://ui.shadcn.com/docs/components

Use `lucide-react` for icons (already installed).

## Styling

Tailwind CSS v4 is configured with a custom "Noche Porteña" theme (warm noir/dark aesthetic inspired by Buenos Aires nightlife).

Key design elements:
- Dark backgrounds with warm amber/gold accents
- Display font (Fraunces) for headers, DM Sans for body
- Grain texture overlay on backgrounds
- Glow effects (`glow-gold-subtle`)

## Database

Use Supabase (PostgreSQL + pgvector) for the database. Use the Supabase JS client, not raw pg drivers.

### Key Tables
- `events` - Event data with embeddings
- `venues` - Venue information
- `profiles` - User profiles (extends Supabase auth)
- `saved_events` - User saved events

### Schema Reference
See `supabase/schema.sql` for the complete schema including:
- Neighborhood enum (48 CABA neighborhoods)
- Venue type enum
- Event status enum
- pgvector indexes for semantic search

### Views Security

**Always use `security_invoker = true` when creating views.** This ensures Row Level Security (RLS) policies are respected by running the view with the querying user's permissions, not the view creator's.

```sql
-- CORRECT: View respects RLS
CREATE VIEW my_view
WITH (security_invoker = true) AS
SELECT * FROM my_table;

-- WRONG: View bypasses RLS (security risk)
CREATE VIEW my_view AS
SELECT * FROM my_table;
```

Without `security_invoker = true`, views default to `SECURITY DEFINER` which bypasses RLS and triggers Supabase Security Advisor warnings.

### Query Keys

Use centralized query keys from `@/shared/lib/query`:

```tsx
import { queryKeys } from '@/shared/lib/query'

// In hooks
queryClient.invalidateQueries({ queryKey: queryKeys.events.trending() })
queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
```

### Supabase CLI

Use the Supabase CLI through `bunx` for database operations like migrations, schema changes, and management tasks. The CLI is more reliable than MCP tools for these operations.

```bash
# Link to project (one-time setup)
bunx supabase link --project-ref <project-ref>

# Push local migrations to remote database
bunx supabase db push

# Pull remote schema changes
bunx supabase db pull

# Create a new migration
bunx supabase migration new <migration_name>

# List migration status
bunx supabase migration list

# Repair migration history if out of sync
bunx supabase migration repair --status applied <version>
bunx supabase migration repair --status reverted <version>

# Generate TypeScript types from schema
bunx supabase gen types typescript --project-id <project-ref> > src/shared/lib/types/database.ts
```

## AI/LLM

All text generation runs through the **Vercel AI SDK** (`ai`) on DeepSeek V4 Flash
(`deepseek-v4-flash`, via `@ai-sdk/deepseek` — DeepSeek's OpenAI-compatible endpoint).
Embeddings use OpenAI via `@ai-sdk/openai` (`text-embedding-3-small`) — DeepSeek has no
embeddings API.

Providers and helpers: `src/shared/lib/ai/providers.ts` (`textModel`, `embeddingModel`,
`NO_THINKING`). Model config: `src/shared/lib/ai/constants.ts` (`AI_MODEL`, `AI_BASE_URL`,
`AI_API_KEY` resolution: `AI_API_KEY` > `DEEPSEEK_API_KEY` > `ANTHROPIC_API_KEY`).

- Chat agent: `src/routes/api/chat.ts` (`streamText({ model: textModel })`), tools
  `search_events` (semantic + filtered event search) and `get_venue_details`.
- Categorization, enrichment, titles, venue review: `generateObject` (schema-validated) or
  `generateText`. DeepSeek ships thinking mode on by default; all calls spread `NO_THINKING`
  (`providerOptions: { deepseek: { thinking: { type: 'disabled' } } }`).
- Structured output: `generateObject` validates and auto-repairs JSON — no manual parsing.

To revert to Anthropic, re-add `@ai-sdk/anthropic` and swap the provider in
`src/shared/lib/ai/providers.ts` (`createAnthropic({ apiKey: ... })`), keeping `AI_MODEL`
set to a Claude model.

## Internationalization (i18n)

Uses Paraglide JS with English (en) and Spanish (es) locales. Spanish is the base locale.

### Usage
```tsx
import * as m from '@/paraglide/messages'

// In components
<h1>{m.nav_home()}</h1>
```

### Adding translations
Edit `messages/en.json` and `messages/es.json`. Keys are organized by feature:
- `nav_*` - Navigation
- `auth_*`, `login_*`, `register_*` - Authentication
- `chat_*`, `prompt_*` - Chat interface
- `admin_*` - Admin dashboard
- `common_*` - Shared strings
- `saved_*` - Saved events

### Key Naming Conventions

**Keys should reflect purpose/meaning, not literal content:**
- Keys represent the semantic purpose of the text, not its exact wording
- When content changes significantly, **rename the key** to match the new meaning
- Example: `admin_tab_all` → `admin_tab_active` when changing from "All Events" to "Active Events"

**Why this matters:**
- Prevents confusion when keys don't match their content
- Makes code more self-documenting
- Helps translators understand context

**When to rename vs. keep:**
- **Rename** when the meaning/purpose changes (e.g., "All" → "Active")
- **Keep** when only wording changes but meaning stays the same (e.g., "Sign In" → "Log In")

Runtime locale access:
```tsx
import { getLocale } from '@/paraglide/runtime'
const locale = getLocale() // 'en' or 'es'
```

## Authentication

Uses Supabase Auth with the `AuthProvider` context.

```tsx
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'

function Component() {
  const { user, isAdmin, signOut } = useAuthContext()
  // ...
}
```

Roles are stored in `profiles.role` ('user' or 'admin').

### Route Protection

Use `beforeLoad` hooks for auth checks:

```tsx
// In route file
import { requireAuth, requireAdmin } from '@/features/auth/api/session'

export const Route = createFileRoute('/admin/')({
  beforeLoad: requireAdmin,  // Redirects to / if not admin
  component: AdminDashboard,
})
```

## Analytics

Uses PostHog for event tracking. Track events in mutations:

```tsx
import { track } from '@/shared/lib/analytics'

// In mutation onSuccess
track('admin:event_created', { eventId: result.id })
```

Event types are defined in `src/shared/lib/analytics.ts`.

## Common Patterns

### Mutation Hooks with Side Effects

```tsx
export function useCreateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: EventInsert) => createEventAction({ data }),
    onSuccess: (result) => {
      track('admin:event_created', { id: result.id })
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      toast.success('Event created')
    },
    onError: () => {
      toast.error('Failed to create event')
    },
  })
}
```

### API Response Utilities

For the public API endpoint:

```tsx
import { apiSuccess, apiList, apiError, withCache } from '@/shared/lib/api-response'

// In API handler
return apiSuccess(data)
return apiList(items, totalCount)
return apiError('Not found', 404)
```

### Cache Invalidation

This project uses **two different data fetching patterns**:

1. **Route Loaders** - Trending events are loaded via the route `loader` on `/`, accessed via `Route.useLoaderData()`
2. **TanStack Query** - Conversations (and home-grid refetches) use `useQuery` hooks

Invalidate with the centralized query keys from `@/shared/lib/query`:

```tsx
import { queryKeys } from '@/shared/lib/query'

queryClient.invalidateQueries({ queryKey: queryKeys.conversations.list() })
queryClient.invalidateQueries({ queryKey: queryKeys.events.trending() })
```

## Environment Variables

```bash
# Supabase (server-side)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Supabase (browser-side - VITE_ prefix required for client access)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# AI APIs
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Admin API (optional for local dev)
ADMIN_API_KEY=
```

**Note:** Variables with `VITE_` prefix are exposed to the browser. Never prefix secrets with `VITE_`.

## Testing

```bash
bun test              # Run all tests
bun test --watch      # Watch mode
```

Tests use Vitest with React Testing Library. Test infrastructure is set up but test coverage is minimal.

## Debugging & Logging

Server-side logs are written to both the terminal AND `logs/server.log`.

### Watching Logs

```bash
# Watch logs in real-time
tail -f logs/server.log

# Filter for errors only
tail -f logs/server.log | grep ERROR

# Filter for a specific module
tail -f logs/server.log | grep Meetup

# View recent logs
cat logs/server.log | tail -100
```

### Using the Logger

```typescript
import { logger } from '@/shared/lib/logger'

// Log levels: debug, info, warn, error
logger.info('Starting import', { source: 'meetup', count: 50 })
logger.error('Failed to connect', { error: err.message })
logger.debug('Processing event', { eventId: '123' })

// For errors with stack traces
logger.logError('Import failed', error, { source: 'passline' })
```

### Log Format

```
[2026-01-22T15:30:00.000Z] [INFO ] [Meetup] Starting scrape {"startDate":"2026-01-22","daysCount":30}
[2026-01-22T15:30:10.000Z] [ERROR] [Meetup] Error scraping date {"date":"2026-01-27","error":"..."}
```

### Configuration

- `LOG_LEVEL` env var controls minimum level (default: `debug`)
- Logs are NOT written to file in test environment
- Log directory (`logs/`) is gitignored

## Best Practices

- Keep components small and focused
- Use TypeScript strictly - no `any` types
- Prefer server functions over client-side API calls
- Use TanStack Query for data fetching (integrated via router)
- Use React Hook Form + Zod for forms
- **After each code change, run `bunx tsc --noEmit` to check for TypeScript errors and fix them immediately** - don't leave errors for later
- **NEVER add backwards compatibility shims or legacy exports** - when changing APIs, update all callsites instead. Only add compatibility layers if explicitly requested.
- **NEVER use barrel imports** - Import directly from source files (e.g., `@/features/auth/hooks/useAuthContext`) instead of barrel index files (e.g., `@/features/auth`). This improves tree-shaking and bundle size.

## Documentation

- **Update docs when making relevant changes** - if you modify a system that has documentation in `docs/`, update the docs to reflect those changes
- **Record architectural decisions** - when making important architectural decisions, add them to `docs/decisions.md` with:
  - Date
  - What was decided
  - Alternatives considered (if applicable)
  - Rationale for the decision
- **NEVER modify old decisions** - decisions are a historical record. When a decision is superseded or reversed, create a NEW decision entry that references the old one (e.g., "Related Decision: [Old Decision Name] (Date)"). This preserves the decision history and rationale evolution.

## Event Import & Enrichment

Events are scraped from external sources (Passline, Eventbrite, BA Tourism,
Meetup, Luma, Venti) by Trigger.dev background jobs in `src/trigger/jobs/`.
Each source has a scraper under `src/features/import/scrapers/`; imported
events pass through duplicate detection (`checkDuplicateEvents`) and venue
matching (`matchVenue`), then get AI-enriched descriptions.

See `docs/event-import-enrichment.md` for detailed information about each source and the enrichment process.
