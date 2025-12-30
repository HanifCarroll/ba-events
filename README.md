# BA Events

An AI-powered event discovery app for Buenos Aires. Ask natural language questions like "What's happening tonight?" or "Find me underground techno events" and get personalized recommendations.

## Features

### User Experience
- **Conversational AI**: Chat interface powered by Claude for natural language event discovery
- **Semantic Search**: Vector similarity search using pgvector with smart filters (date, category, neighborhood, price, vibe)
- **Bilingual Interface**: Full English/Spanish support with automatic browser language detection
- **Saved Events**: Create an account to save and track your favorite events
- **Real-time Streaming**: Claude responses stream as they're generated

### Admin Dashboard
- **Event Management**: Create, edit, and bulk manage events
- **Venue Management**: Manage venues with Instagram, website, capacity info
- **7-Step Import Wizard**: Import events from multiple sources with preview and validation
- **Background Enrichment**: AI-powered description enhancement with progress tracking
- **Data Tables**: Sortable, filterable tables with column preferences

### Event Sources
- **Passline**: Ticketing platform for concerts and nightlife
- **Eventbrite**: Event platform with detailed descriptions
- **BA Tourism**: Official Buenos Aires tourism website
- **Meetup**: Community events and gatherings

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun |
| Framework | TanStack Start (React 19 + Vite + Nitro) |
| AI | Claude (Anthropic SDK) |
| Database | Supabase (PostgreSQL + pgvector) |
| Embeddings | OpenAI |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui + Radix |
| Forms | React Hook Form + Zod |
| i18n | Paraglide JS |
| Rate Limiting | Upstash Redis |
| Browser Automation | Playwright |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- Supabase project with the schema from `supabase/schema.sql`
- Anthropic API key
- OpenAI API key (for embeddings)
- Upstash Redis (for rate limiting)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/HanifCarroll/ba-events.git
   cd ba-events
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Create `.env` file from example:
   ```bash
   cp .env.example .env
   ```

4. Add your API keys to `.env`:
   ```
   # Supabase (server-side)
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key

   # Supabase (browser-side)
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key

   # AI APIs
   OPENAI_API_KEY=sk-your-openai-key
   ANTHROPIC_API_KEY=sk-ant-your-anthropic-key

   # Rate Limiting
   UPSTASH_REDIS_REST_URL=your-upstash-url
   UPSTASH_REDIS_REST_TOKEN=your-upstash-token

   # Admin API
   ADMIN_API_KEY=your-admin-api-key
   ```

5. Set up the database:
   - Run `supabase/schema.sql` in your Supabase SQL editor
   - Optionally run `supabase/seed.sql` for sample data

6. Start the dev server:
   ```bash
   bun run dev
   ```

   The app will be available at [http://localhost:3000](http://localhost:3000)

## Scripts

```bash
bun run dev      # Start development server (port 3000)
bun run build    # Build for production
bun run preview  # Preview production build
bun test         # Run tests
```

## Project Structure

```
src/
├── components/
│   ├── admin/        # Admin dashboard components
│   │   └── import/   # 7-step import wizard
│   ├── chat/         # Chat UI components
│   ├── data-table/   # Reusable data tables
│   ├── events/       # Event card and list components
│   └── ui/           # shadcn/ui components
├── hooks/            # Custom React hooks
├── lib/
│   ├── ai.ts         # Claude agent with tools
│   ├── admin.ts      # Admin server functions
│   ├── auth.ts       # Authentication functions
│   ├── embeddings.ts # OpenAI embeddings
│   ├── enrichment.ts # Event description enrichment
│   ├── supabase.ts   # Database queries
│   ├── schemas.ts    # Zod validation schemas
│   └── scrapers/     # Event source scrapers
├── paraglide/        # i18n translations (auto-generated)
├── routes/
│   ├── admin/        # Admin routes
│   ├── auth/         # OAuth callbacks
│   └── api/          # API endpoints
├── styles.css        # Global styles
└── router.tsx        # Router configuration

messages/             # i18n translation files (en.json, es.json)
supabase/             # Database schema and seeds
docs/                 # Project documentation
```

## AI Agent Tools

The Claude agent has access to:

- **search_events**: Find events by date, category, neighborhood, price, vibe, or semantic query
- **get_venue_details**: Get venue info (website, Instagram, capacity, etc.)

## Data Model

### Events
- Name, bilingual descriptions (Spanish/English)
- Date/time, venue with neighborhood
- Categories (techno, jazz, art, comedy, etc.)
- Vibes (underground, chill, romantic, etc.)
- Price and age restrictions
- Vector embeddings for semantic search

### Venues
- Name, address, neighborhood
- Type (club, bar, theater, gallery, etc.)
- Website, Instagram handle
- Capacity

## Routes

### Public
- `/` - Home/chat page
- `/login`, `/register` - Authentication
- `/saved` - Saved events (authenticated)
- `/profile` - User profile

### Admin (requires admin role)
- `/admin/` - Dashboard
- `/admin/events/` - Event management
- `/admin/events/import` - Import wizard
- `/admin/venues/` - Venue management

## Documentation

See the `docs/` folder for detailed documentation:
- `decisions.md` - Architectural decisions
- `event-import-enrichment.md` - Import sources and enrichment process
- `prd.md` - Product requirements

## License

MIT
