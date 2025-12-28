# BA Events

An AI-powered event discovery app for Buenos Aires. Ask natural language questions like "What's happening tonight?" or "Find me underground techno events" and get personalized recommendations.

## Features

- **Conversational AI**: Chat interface powered by Claude for natural language event discovery
- **Smart Search**: Semantic search with filters for date, category, neighborhood, price, and vibe
- **Venue Details**: Get info about venues including Instagram, website, capacity, and location
- **Real-time Streaming**: Responses stream as they're generated for a responsive UX

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Framework | TanStack Start (React 19 + Vite + Nitro) |
| AI | Claude (Anthropic SDK) |
| Database | Supabase (PostgreSQL + pgvector) |
| Embeddings | OpenAI |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui + Radix |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- Supabase project with events database
- Anthropic API key
- OpenAI API key (for embeddings)

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
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   OPENAI_API_KEY=sk-your-openai-key
   ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
   ```

5. Start the dev server:
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
│   ├── chat/       # Chat UI components
│   ├── events/     # Event card and list components
│   └── ui/         # shadcn/ui components
├── lib/
│   ├── ai.ts       # Claude agent with tools
│   ├── supabase.ts # Database queries
│   ├── embeddings.ts # OpenAI embeddings
│   └── types.ts    # TypeScript types
├── routes/         # TanStack Router pages
└── styles.css      # Global styles
```

## AI Agent Tools

The Claude agent has access to:

- **search_events**: Find events by date, category, neighborhood, price, vibe, or semantic query
- **get_venue_details**: Get venue info (website, Instagram, capacity, etc.)

## Data Model

Events include:
- Name, description, date/time
- Venue with neighborhood and address
- Categories (techno, jazz, art, comedy, etc.)
- Vibes (underground, chill, romantic, etc.)
- Price and age restrictions
- Links to tickets and more info

## License

MIT
