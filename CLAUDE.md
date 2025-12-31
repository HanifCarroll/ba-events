# BA Events - Project Guidelines

## Runtime

Always use **Bun** instead of Node.js, npm, pnpm, or yarn.

```bash
bun install          # Install dependencies
bun run dev          # Start dev server (port 3000)
bun run build        # Production build
bun run preview      # Preview production build
bun test             # Run tests
```

Bun automatically loads `.env` files - don't use dotenv.

**Important:** Never start the dev server yourself. The user will always have it running.

## Framework

This is a **TanStack Start** project with:
- TanStack Router (file-based routing in `src/routes/`)
- TanStack Query for data fetching
- React 19
- Vite + Nitro
- Tailwind CSS v4

### Routing

Routes are in `src/routes/`. The route tree is auto-generated in `src/routeTree.gen.ts`.

```
src/routes/
├── __root.tsx           # Root layout with auth provider
├── index.tsx            # Home/chat page (/)
├── login.tsx            # Login page
├── register.tsx         # Registration page
├── saved.tsx            # Saved events
├── profile.tsx          # User profile
├── admin/
│   ├── index.tsx        # Admin dashboard
│   ├── login.tsx        # Admin login
│   ├── events/
│   │   ├── index.tsx    # Event list
│   │   ├── new.tsx      # Create event
│   │   ├── $id.tsx      # Edit event
│   │   └── import.tsx   # Import wizard
│   └── venues/
│       ├── index.tsx    # Venue list
│       ├── new.tsx      # Create venue
│       ├── $id.tsx      # Edit venue
│       └── import.tsx   # CSV import
├── auth/
│   └── callback.tsx     # OAuth callback
└── api/
    └── events.ts        # External event submission API
```

Create new routes by adding files to `src/routes/`. Dynamic routes use `$param` syntax:
- `src/routes/admin/events/$id.tsx` → `/admin/events/:id`

### Server Functions

Use TanStack Start server functions for API calls:

```tsx
import { createServerFn } from '@tanstack/react-start'

// Simple server function (no input)
const getEvents = createServerFn({ method: 'GET' }).handler(async () => {
  // This runs on the server
  return db.query('SELECT * FROM events')
})

// Server function with input validation (use inputValidator, NOT validator)
const createEvent = createServerFn({ method: 'POST' })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    return db.insert('events', data)
  })
```

## UI Components

**Always use shadcn/ui components** for UI elements. If a component isn't installed, add it:

```bash
bunx shadcn@latest add button
bunx shadcn@latest add card
bunx shadcn@latest add input
# etc.
```

Components will be installed to `src/components/ui/`.

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

## AI/LLM

Use the Anthropic SDK with Claude for the AI agent. The agent is in `src/lib/ai/agent.ts`.

Tools available to Claude:
- `search_events` - Semantic and filtered event search
- `get_venue_details` - Venue information lookup

For embeddings, use OpenAI via `src/lib/ai/embeddings.ts`.

## Internationalization (i18n)

Uses Paraglide JS with English (en) and Spanish (es) locales.

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

Runtime locale access:
```tsx
import { getLocale } from '@/paraglide/runtime'
const locale = getLocale() // 'en' or 'es'
```

## Authentication

Uses Supabase Auth with the `AuthProvider` context.

```tsx
import { useAuthContext } from '@/components/AuthProvider'

function Component() {
  const { user, isAdmin, signOut } = useAuthContext()
  // ...
}
```

Roles are stored in `profiles.role` ('user' or 'admin').

## Testing

```bash
bun test              # Run all tests
bun test --watch      # Watch mode
```

Tests use Vitest with React Testing Library.

## Project Structure

```
src/
├── components/
│   ├── ui/              # shadcn components (auto-generated)
│   ├── admin/           # Admin dashboard components
│   │   └── import/      # 7-step import wizard components
│   ├── chat/            # Chat UI components
│   ├── data-table/      # Reusable data table components
│   ├── events/          # Event display components
│   ├── AuthProvider.tsx # Auth context
│   ├── MainLayout.tsx   # Sidebar navigation layout
│   └── LanguageSwitcher.tsx
├── hooks/               # Custom React hooks
│   ├── useEventAdmin.ts       # Event admin orchestration
│   ├── useEventFiltering.ts   # Event filtering logic
│   ├── useEventMutations.ts   # Event CRUD mutations
│   ├── useVenueMutations.ts   # Venue CRUD mutations
│   ├── useBulkActions.ts      # Bulk select/edit/delete
│   ├── useImportWizard.ts     # Multi-step import wizard state
│   ├── useBackgroundEnrichment.ts # Track enrichment progress
│   └── useAuthContext.ts      # Auth context hook
├── lib/
│   ├── ai/              # AI/LLM code
│   │   ├── agent.ts     # Claude agent with tools
│   │   ├── embeddings.ts # OpenAI embeddings
│   │   └── enrichment.ts # Event description enrichment
│   ├── admin/           # Admin server functions
│   │   ├── index.ts     # Main exports
│   │   ├── events.ts    # Event CRUD
│   │   ├── venues.ts    # Venue CRUD
│   │   ├── moderation.ts # Event moderation
│   │   ├── enrichment.ts # Batch enrichment
│   │   ├── stats.ts     # Dashboard stats
│   │   ├── utils.ts     # Shared utilities
│   │   └── sources/     # Import source handlers
│   ├── auth/            # Authentication
│   │   ├── client.ts    # Browser-side Supabase auth
│   │   ├── session.ts   # Server session management
│   │   └── rate-limit.ts # Upstash Redis rate limiting
│   ├── chat/            # Chat feature
│   │   ├── messages.ts  # Message utilities
│   │   └── saved.ts     # Saved events logic
│   ├── db/              # Database layer
│   │   ├── client.ts    # Supabase queries
│   │   └── server.ts    # Server-side Supabase client
│   ├── scrapers/        # Event source scrapers
│   │   ├── passline/
│   │   ├── eventbrite/
│   │   ├── ba-tourism/
│   │   ├── meetup/
│   │   ├── index.ts
│   │   └── venue-matcher.ts
│   ├── utils/           # Shared utilities
│   │   ├── index.ts     # General utilities (cn, etc.)
│   │   └── formatting.ts # Date/time formatting
│   ├── analytics.ts     # PostHog tracking
│   ├── query.ts         # React Query setup
│   ├── schemas.ts       # Zod validation schemas
│   ├── source-metadata.ts # Data gaps per source
│   └── types.ts         # TypeScript types
├── paraglide/           # i18n (auto-generated)
├── routes/              # TanStack Router pages
├── styles.css           # Global styles
└── router.tsx           # Router configuration

messages/                # i18n translation files
├── en.json
└── es.json

supabase/                # Database
├── schema.sql           # Full schema
└── seed.sql             # Sample data

docs/                    # Documentation
├── decisions.md         # Architectural decisions
├── event-import-enrichment.md
└── prd.md
```

## Best Practices

- Keep components small and focused
- Use TypeScript strictly - no `any` types
- Prefer server functions over client-side API calls
- Use TanStack Query for data fetching (integrated via router)
- Use React Hook Form + Zod for forms
- **After each code change, run `bunx tsc --noEmit` to check for TypeScript errors and fix them immediately** - don't leave errors for later
- **NEVER add backwards compatibility shims or legacy exports** - when changing APIs, update all callsites instead. Only add compatibility layers if explicitly requested.

## Documentation

- **Update docs when making relevant changes** - if you modify a system that has documentation in `docs/`, update the docs to reflect those changes
- **Record architectural decisions** - when making important architectural decisions, add them to `docs/decisions.md` with:
  - Date
  - What was decided
  - Alternatives considered (if applicable)
  - Rationale for the decision
- **NEVER modify old decisions** - decisions are a historical record. When a decision is superseded or reversed, create a NEW decision entry that references the old one (e.g., "Related Decision: [Old Decision Name] (Date)"). This preserves the decision history and rationale evolution.

## Event Import & Enrichment

The app supports importing events from 4 sources via a 7-step wizard:

1. **Source Selection** - Choose Passline, Eventbrite, BA Tourism, or Meetup
2. **Configuration** - Set source-specific options
3. **Venue Mapping** - Match to existing venues or create new ones
4. **Event Selection** - Preview and filter events to import
5. **Confirmation** - Review before import
6. **Enrichment** - Optional AI description enhancement
7. **Summary** - Import completion details

See `docs/event-import-enrichment.md` for detailed information about each source and the enrichment process.
