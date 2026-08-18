# Enrichment Adapter Pattern

## Overview

The enrichment adapter pattern provides a unified interface for source-specific event enrichment, handling the complexity of different extraction strategies, language detection, and client/server routing.

Each import source (Passline, Meetup, Luma, BA Tourism, Eventbrite) has unique technical challenges:
- Some sites block server-side requests (Cloudflare)
- Some have structured data (JSON-LD, `__NEXT_DATA__`)
- Some require AI extraction from unstructured HTML
- Some have known languages, others need detection

The adapter pattern encapsulates these differences behind a common interface.

## Core Interface

### EnrichmentAdapter<TPreviewEvent>

```typescript
interface EnrichmentAdapter<TPreviewEvent> {
  source: ImportSource
  capabilities: {
    descriptions: boolean  // Can extract descriptions
    venues: boolean        // Can extract venue names
  }
  config: EnrichmentConfig

  // Client-side extraction (for Cloudflare-blocked sources)
  extractDescriptions?(events, onProgress): Promise<DescriptionExtractionResult[]>
  extractVenues?(events, onProgress): Promise<VenueExtractionResult[]>

  // Server-side extraction (for accessible sources)
  serverEnrich?(link, options): Promise<ServerEnrichmentResult | null>

  // URL resolver for the source
  getEnrichmentUrl?(event): string | null
}
```

### EnrichmentConfig

| Property | Type | Description |
|----------|------|-------------|
| `requiresClientSide` | `boolean` | Forces browser-based extraction |
| `strategyReason` | `string` | Documents WHY this strategy was chosen |
| `knownLanguage` | `'es' \| 'en' \| undefined` | Skip language detection if known |
| `concurrency` | `number` | Max parallel requests |
| `delayMs` | `number` | Rate limiting delay between requests |

## Client-Side vs Server-Side Enrichment

### When to Use Client-Side

Set `requiresClientSide: true` when:
- Source uses Cloudflare or other bot protection
- Content is only rendered via JavaScript in browser

Implementation:
- Implement `extractDescriptions()` and/or `extractVenues()`
- Use browser context to fetch pages
- Process in batches with progress callbacks

**Example: Passline**
```typescript
config: {
  requiresClientSide: true,
  strategyReason: 'Cloudflare blocks server-side requests',
  knownLanguage: 'es',
}
```

### When to Use Server-Side

Set `requiresClientSide: false` when:
- Source is accessible from server
- Can use Jina Reader or direct fetch

Implementation:
- Implement `serverEnrich(link, options)`
- Return `{ description_es, description_en, venue_name }`

**Example: Luma**
```typescript
config: {
  requiresClientSide: false,
  strategyReason: 'Direct fetch works; extracts from __NEXT_DATA__ and JSON-LD',
  knownLanguage: undefined, // Needs detection
}
```

## Decision Matrix

| Source | Strategy | Reason | Description Method | Venue Method | Language |
|--------|----------|--------|-------------------|--------------|----------|
| **Passline** | Client-side | Cloudflare blocks server | JSON-LD `description` | JSON-LD `location.name` | Spanish (es) |
| **Meetup** | Server direct fetch | Jina returns HTTP 451 | `__NEXT_DATA__` props | JSON-LD `@type: Place` | Auto-detect |
| **Luma** | Server direct fetch | Works normally | `__NEXT_DATA__` or JSON-LD | `geo_address_json` | Auto-detect |
| **BA Tourism** | Server Jina + AI | Works normally | Jina markdown → Haiku | Regex after "¿Dónde?" | Spanish (es) |
| **Eventbrite** | Server Jina + AI | Works normally | Jina markdown → Haiku | JSON-LD Event.location | Auto-detect |

### Decision Factors

1. **Cloudflare/Bot Protection** → Use client-side extraction (browser context)
2. **Jina Legal Restrictions (HTTP 451)** → Use direct fetch with browser headers
3. **Structured Data Available (JSON-LD, `__NEXT_DATA__`)** → Use direct extraction (no AI)
4. **Complex/Unstructured HTML** → Use AI extraction (Claude Haiku)
5. **Known Language (Spanish sources)** → Skip language detection

## Type Guards

The adapter pattern provides type guards for safe capability checking:

```typescript
import {
  hasClientDescriptionExtraction,
  hasClientVenueExtraction,
  hasServerEnrichment,
} from '@/features/import/adapters/enrichment'

const adapter = getEnrichmentAdapter(source)

// Check server-side capability
if (adapter && hasServerEnrichment(adapter)) {
  const result = await adapter.serverEnrich(link, { extractVenue: true })
}

// Check client-side capability
if (adapter && hasClientDescriptionExtraction(adapter)) {
  const results = await adapter.extractDescriptions(events, onProgress)
}
```

## Registry Functions

```typescript
import {
  getEnrichmentAdapter,
  requiresClientSideEnrichment,
  supportsDescriptionEnrichment,
  supportsVenueEnrichment,
  getKnownLanguage,
} from '@/features/import/adapters/enrichment'

// Get adapter for a source
const adapter = getEnrichmentAdapter('passline')

// Check if source requires client-side enrichment
if (requiresClientSideEnrichment('passline')) {
  // Route to client-side extraction
}

// Check capabilities
if (supportsDescriptionEnrichment('luma')) {
  // Can enrich descriptions for this source
}

// Get known language (or undefined for auto-detect)
const language = getKnownLanguage('ba-tourism') // 'es'
```

## Usage Examples

### Server-Side Batch Enrichment (event-enrichment.ts)

The server-side enrichment job uses adapters to route to the correct extraction method:

```typescript
// In enrichSingleEvent()
const adapter = getEnrichmentAdapter(source as ImportSource)

// Skip sources that require client-side enrichment
if (adapter?.config.requiresClientSide) {
  return {
    eventId: id,
    success: false,
    error: `${source} requires client-side extraction`,
  }
}

// Use adapter's serverEnrich if available
if (adapter && hasServerEnrichment(adapter)) {
  enrichmentResult = await adapter.serverEnrich(link, { extractVenue: needsVenue })

  // Handle language detection for adapters that return description_en
  if (enrichmentResult?.description_en && !enrichmentResult.description_es) {
    const detectedLang = await detectLanguage(enrichmentResult.description_en)
    if (detectedLang === 'spanish') {
      enrichmentResult.description_es = enrichmentResult.description_en
      enrichmentResult.description_en = await translateText(...)
    }
  }
}
```

### Client-Side Extraction (useImportWizard.ts)

Client-side enrichment runs in the browser during import:

```typescript
const adapter = getEnrichmentAdapter(source)

if (hasClientDescriptionExtraction(adapter)) {
  const results = await adapter.extractDescriptions(events, (progress) => {
    setEnrichmentProgress({ current: progress.current, total: progress.total })
  })

  // Merge results back into events
  for (const result of results) {
    if (result.description) {
      eventMap[result.eventId].description = result.description
    }
  }
}
```

### Hook-Based Enrichment (usePasslineDescriptionEnrichment.ts)

For enriching events from the admin page:

```typescript
// Two-phase enrichment:
// 1. Client-side extraction (runs in browser)
const rawResults = await extractPasslineEventsBatchClient(
  events,
  onProgress,
  shouldContinue
)

// 2. Server-side translation (runs on server)
await enrichPasslineDescriptionsAction({ data: batch })
```

## Adding a New Source

1. **Create adapter file**: `src/features/import/adapters/enrichment/{source}-enrichment.ts`

2. **Implement the interface**:
   ```typescript
   export const mySourceEnrichmentAdapter: EnrichmentAdapter<MySourcePreviewEvent> = {
     source: 'my-source',
     capabilities: { descriptions: true, venues: true },
     config: {
       requiresClientSide: false, // or true
       strategyReason: 'Document why this strategy',
       knownLanguage: 'es', // or undefined
       concurrency: 3,
       delayMs: 1000,
     },
     serverEnrich: async (link, options) => {
       // Implement extraction logic
     },
     getEnrichmentUrl: (event) => event.transformed.link,
   }
   ```

3. **Add to registry**: `src/features/import/adapters/enrichment/index.ts`
   ```typescript
   import { mySourceEnrichmentAdapter } from './my-source-enrichment'

   const enrichmentAdapters = {
     // ... existing adapters
     'my-source': mySourceEnrichmentAdapter,
   }
   ```

4. **Update this documentation** with the new source's strategy

## Related Files

- `src/features/import/adapters/enrichment-types.ts` - Interface definitions
- `src/features/import/adapters/enrichment/` - Adapter implementations
  - `passline-enrichment.ts` - Client-side (Cloudflare)
  - `meetup-enrichment.ts` - Server direct fetch (Jina 451)
  - `luma-enrichment.ts` - Server direct fetch
  - `ba-tourism-enrichment.ts` - Server Jina + AI
  - `eventbrite-enrichment.ts` - Server Jina + AI
- `src/features/import/core/event-enrichment.ts` - Server-side batch enrichment job
- `src/features/events/hooks/usePasslineDescriptionEnrichment.ts` - Client-side Passline hook
- `src/features/events/hooks/useLumaDescriptionEnrichment.ts` - Client-side Luma hook
- `docs/event-import-enrichment.md` - Import process documentation

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Event Enrichment Flow                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐     ┌───────────────────────────────────────────┐ │
│  │ Import       │     │            Enrichment Adapters             │ │
│  │ Wizard       │────▶│ ┌─────────┐ ┌─────────┐ ┌─────────┐      │ │
│  │ (Browser)    │     │ │Passline │ │ Meetup  │ │  Luma   │ ...  │ │
│  └──────────────┘     │ │(Client) │ │(Server) │ │(Server) │      │ │
│                       │ └────┬────┘ └────┬────┘ └────┬────┘      │ │
│  ┌──────────────┐     │      │           │           │           │ │
│  │ Admin Page   │     └──────┼───────────┼───────────┼───────────┘ │
│  │ Bulk Actions │────────────┘           │           │             │
│  └──────────────┘                        │           │             │
│                                          ▼           ▼             │
│                              ┌─────────────────────────┐           │
│                              │  event-enrichment.ts    │           │
│                              │  (Server-side batch job)│           │
│                              └────────────┬────────────┘           │
│                                           │                        │
│                                           ▼                        │
│                              ┌─────────────────────────┐           │
│                              │    Supabase Events      │           │
│                              │ (descriptions, venues)  │           │
│                              └─────────────────────────┘           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```
