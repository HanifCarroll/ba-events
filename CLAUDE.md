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
- React 19
- Vite + Nitro
- Tailwind CSS v4

### Routing

Routes are in `src/routes/`. The route tree is auto-generated in `src/routeTree.gen.ts`.

```
src/routes/
├── __root.tsx      # Root layout
├── index.tsx       # Home page (/)
└── about.tsx       # About page (/about)
```

Create new routes by adding files to `src/routes/`. Dynamic routes use `$param` syntax:
- `src/routes/events/$id.tsx` → `/events/:id`

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

Tailwind CSS v4 is configured. Import styles in components:

```tsx
import '../styles.css'
```

Use Tailwind utility classes. Follow shadcn's conventions for component styling.

## Database

Use Supabase (PostgreSQL + pgvector) for the database. Use the Supabase JS client, not raw pg drivers.

## AI/LLM

Use the Anthropic SDK with Claude for the AI agent.

## Testing

```bash
bun test              # Run all tests
bun test --watch      # Watch mode
```

Tests use Vitest with React Testing Library.

## Project Structure

```
src/
├── components/       # React components
│   └── ui/          # shadcn components (auto-generated)
├── routes/          # TanStack Router pages
├── data/            # Data utilities
├── styles.css       # Global styles
└── router.tsx       # Router configuration
```

## Best Practices

- Keep components small and focused
- Use TypeScript strictly - no `any` types
- Prefer server functions over client-side API calls
- Use TanStack Query for data fetching (integrated via router)
