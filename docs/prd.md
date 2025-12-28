# BA Events Agent

> An AI agent to help users discover events in Buenos Aires, solving the problem of fragmented event information.

## Problem

Buenos Aires events are scattered across:
- Instagram accounts (venues, promoters, @fiabordo, etc.)
- Facebook events
- WhatsApp groups
- Eventbrite / Fever / Passline
- Individual venue websites
- Word of mouth

No single place to find what's happening.

---

## Solution

An AI agent with a chat interface (web or WhatsApp) where users can ask:
- "What's happening tonight for techno?"
- "Good date night events this Saturday?"
- "Art exhibitions in Palermo this week?"

Agent searches a consolidated events database and returns personalized recommendations.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   DATA COLLECTION                    │
│                                                      │
│  Scrapers → Instagram, Facebook, Eventbrite, etc.   │
│  Manual entry → WhatsApp tips, submissions          │
│  APIs → Where available                             │
└─────────────────┬───────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────┐
│                   EVENTS DATABASE                    │
│                                                      │
│  PostgreSQL + pgvector (Supabase)                   │
│  - Event name, date, time, venue                    │
│  - Category, vibe, price                            │
│  - Description (embedded for semantic search)       │
│  - Source link                                      │
└─────────────────┬───────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────┐
│                    AI AGENT                          │
│                                                      │
│  RAG over events database                           │
│  Filters: date, category, neighborhood, price       │
│  Semantic search for vibe/intent                    │
└─────────────────┬───────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────┐
│                   INTERFACE                          │
│                                                      │
│  MVP: Web chat                                      │
│  Later: WhatsApp Business API                       │
└─────────────────────────────────────────────────────┘
```

---

## Data Model

```typescript
interface Event {
  id: string
  name: string
  description: string
  date: Date
  time: string
  venue: string
  neighborhood: string  // Palermo, San Telmo, Recoleta, etc.
  category: string[]    // techno, jazz, art, food, comedy, etc.
  vibe: string[]        // underground, chill, high-energy, romantic
  price: number | 'free'
  link: string
  source: string        // where we got it from
  embedding: number[]   // for semantic search
}
```

---

## Data Sources

| Source | Method | Difficulty | Priority |
|--------|--------|------------|----------|
| Eventbrite | API or scrape | Medium | High |
| Fever | Scrape | Medium | High |
| Passline | Scrape | Medium | High |
| Facebook Events | Scrape (no API) | Hard | Medium |
| Instagram | Scrape | Hard (anti-bot) | Low |
| Venue websites | Custom scrapers | Medium | Medium |
| User submissions | Form/bot | Easy | High |

**MVP approach:** Start with Eventbrite + Fever + Passline + manual curation.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Language | TypeScript |
| LLM | Claude (Anthropic SDK) |
| Database | Supabase (Postgres + pgvector) |
| Web UI | Next.js or Vite + React |
| Hosting | Vercel |
| Scraping | Puppeteer, Cheerio |

---

## Interface Options

| Interface | Pros | Cons | Build Time |
|-----------|------|------|------------|
| Web chat | Easy, no approval needed | Users must visit site | 1-2 weeks |
| WhatsApp | Users already there | API approval, costs | 3-4 weeks |
| Telegram | Easy API | Smaller user base in BA | 1 week |

**Plan:** Start with web, add WhatsApp if traction.

---

## MVP Scope

- [ ] Scrape 2-3 structured sources (Eventbrite, Fever, Passline)
- [ ] Manual entry form for additional events
- [ ] Supabase database with pgvector
- [ ] Basic RAG agent with filters
- [ ] Simple web chat interface
- [ ] Focus on one category first (music)

---

## Challenges

| Challenge      | Consideration                             |
| -------------- | ----------------------------------------- |
| Data freshness | Events change/cancel—need update strategy |
| Data quality   | Duplicates, inconsistent formats          |
| Coverage       | Will always miss some events              |
| Moderation     | Filter spam if user-submitted             |
| Monetization   | Venue partnerships? Premium features?     |

---

## Why This Project

1. **Real problem** I personally experience
2. **Combines skills:** data pipeline + RAG + agent + UI
3. **Demonstrable:** easy to show to clients
4. **Portfolio piece** for AI agent services
5. **Could become a product** if it gains traction

---

## Status

- [x] Initial concept and architecture
- [ ] Data source research
- [ ] MVP build
- [ ] Launch

---

## Related

- [[projects/rag-agent/overview]] - RAG fundamentals (do this first)
- [[work/master_prospects.csv]] - potential clients for agent services
