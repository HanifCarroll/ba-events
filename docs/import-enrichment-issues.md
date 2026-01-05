# Import & Enrichment System Issues

This document catalogs all identified issues in the event import and enrichment system. **Sections are ordered by implementation priority** - work through them top to bottom.

**Created:** 2026-01-03
**Last Updated:** 2026-01-05 (Step 2 Complete)

---

## Table of Contents

1. [Implementation Roadmap](#implementation-roadmap)
2. [Step 1: Enrichment Status Tracking](#step-1-enrichment-status-tracking)
3. [Step 2: Automatic Enrichment Architecture](#step-2-automatic-enrichment-architecture)
4. [Step 3: Other Critical Issues](#step-3-other-critical-issues)
5. [Lower Priority: Architecture Issues](#lower-priority-architecture-issues)
6. [Lower Priority: Data Quality Issues](#lower-priority-data-quality-issues)
7. [Lower Priority: UX/UI Issues](#lower-priority-uxui-issues)
8. [Implementation Progress](#implementation-progress)
9. [Quick Reference](#quick-reference)

---

## Implementation Roadmap

Complete these in order:

| Step | What | Why | Status |
|------|------|-----|--------|
| **1** | CRIT-03: Enrichment Status Tracking | Prerequisite for automatic enrichment | ✅ Complete |
| **2** | Automatic Enrichment Architecture | Events + venues auto-enrich after import | ✅ Complete |
| **3a** | CRIT-01: find_similar_venue RPC | Fuzzy venue matching is broken | ✅ Complete |
| **3b** | CRIT-02: EventStatus Enum | Potential runtime errors | ✅ Complete |
| **3c** | CRIT-04: Venue Merge | UI feature is broken | ✅ Complete (was already working) |
| **4** | ARCH-01: Wizard Refactor | Code quality (do after core features work) | Not Started |

Steps 3a-3c are independent and can be done in parallel.

---

## Step 1: Enrichment Status Tracking

**This is the PREREQUISITE for automatic enrichment. Do this first.**

### CRIT-03: Enrichment Status Tracking

**Status:** ✅ Complete
**Location:** Database schema, `src/shared/lib/types.ts`
**Impact:** Cannot implement automatic enrichment without tracking what's been enriched

**Problem:**
There's no way to track which events OR venues need enrichment vs which have been enriched. This is REQUIRED before implementing automatic enrichment.

**Solution:**
Add enrichment status tracking to BOTH events and venues tables:

```sql
-- Migration: add_enrichment_status
CREATE TYPE enrichment_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- Events enrichment tracking
ALTER TABLE events
  ADD COLUMN enrichment_status enrichment_status DEFAULT 'pending',
  ADD COLUMN enrichment_error TEXT,
  ADD COLUMN enriched_at TIMESTAMPTZ;

-- Venues enrichment tracking
ALTER TABLE venues
  ADD COLUMN enrichment_status enrichment_status DEFAULT 'pending',
  ADD COLUMN enrichment_error TEXT,
  ADD COLUMN enriched_at TIMESTAMPTZ;

-- Set initial status for existing records based on data completeness
UPDATE events
SET enrichment_status = CASE
  WHEN description_es IS NOT NULL
    AND description_en IS NOT NULL
    AND embedding IS NOT NULL
  THEN 'completed'
  ELSE 'pending'
END;

UPDATE venues
SET enrichment_status = CASE
  WHEN neighborhood IS NOT NULL
    AND latitude IS NOT NULL
  THEN 'completed'
  ELSE 'pending'
END;

-- Indexes for efficient querying of pending records
CREATE INDEX idx_events_enrichment_pending
  ON events (enrichment_status)
  WHERE enrichment_status = 'pending';

CREATE INDEX idx_venues_enrichment_pending
  ON venues (enrichment_status)
  WHERE enrichment_status = 'pending';
```

**TypeScript type update:**
```typescript
// types.ts
export type EnrichmentStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface Event {
  // ... existing fields
  enrichment_status: EnrichmentStatus
  enrichment_error: string | null
  enriched_at: string | null
}

export interface Venue {
  // ... existing fields
  enrichment_status: EnrichmentStatus
  enrichment_error: string | null
  enriched_at: string | null
}
```

**Files to Modify:**
- Create new migration in `supabase/migrations/`
- Update `src/shared/lib/types.ts`
- Update generated Supabase types

---

## Step 2: Automatic Enrichment Architecture

**After CRIT-03 is complete, implement this.**

### Scope

This architecture covers:
1. **Event enrichment** - descriptions, translations, categories, embeddings
2. **Venue enrichment** - address details, coordinates, neighborhood, website, Instagram
3. **Future imports** - automatic enrichment triggered after import completes
4. **Existing records** - backfill mechanism to enrich records imported before this system

### Source Completeness Matrix (Events)

| Field | Passline | Eventbrite | BA Tourism | Meetup | Luma | CSV |
|-------|----------|------------|------------|--------|------|-----|
| description_es | null | provided | provided | partial | often null | optional |
| description_en | null | null | null | partial | null | optional |
| venue_id | match only | auto-create | null initially | null (Phase 2) | auto-create | must exist |
| categories | empty | empty | AI-assigned | empty | empty | optional |
| price | provided | null | null | provided | provided | optional |

### Enrichment Requirements by Source (Events)

```typescript
// src/features/import/config/enrichment-requirements.ts
export const ENRICHMENT_REQUIREMENTS: Record<ImportSource, EnrichmentConfig> = {
  passline: {
    description: { required: true, method: 'jina_claude' },
    venue: { required: true, method: 'detail_page_scrape' },
    translation: { required: true, direction: 'es_to_en' },
    categories: { required: false }, // Done during import
    price: { required: false }, // Already has it
  },
  eventbrite: {
    description: { required: false }, // Already has it
    venue: { required: false }, // Auto-created
    translation: { required: false, direction: 'es_to_en' },
    categories: { required: false }, // Done during import
    price: { required: true, method: 'detail_page_scrape' },
  },
  'ba-tourism': {
    description: { required: false }, // Already has it
    venue: { required: true, method: 'detail_page_scrape' },
    translation: { required: false, direction: 'es_to_en' },
    categories: { required: false }, // Done during import
    price: { required: false }, // Not available
  },
  meetup: {
    description: { required: false }, // Usually has it
    venue: { required: true, method: 'detail_page_scrape' },
    translation: { required: 'conditional', detect: true },
    categories: { required: false }, // Done during import
    price: { required: false }, // Already has it
  },
  luma: {
    description: { required: 'conditional', method: 'playwright_scrape' },
    venue: { required: 'conditional', method: 'detail_page_scrape' },
    translation: { required: false, direction: 'es_to_en' },
    categories: { required: false }, // Done during import
    price: { required: false }, // Already has it
  },
  csv: {
    description: { required: 'conditional', method: 'jina_claude' },
    venue: { required: false }, // Must pre-exist
    translation: { required: 'conditional' },
    categories: { required: 'conditional' },
    price: { required: false },
  },
}
```

### Source Completeness Matrix (Venues)

| Field | Passline | Eventbrite | BA Tourism | Meetup | Luma |
|-------|----------|------------|------------|--------|------|
| name | provided | provided | provided | provided | provided |
| address | partial (in venue name) | provided | null | provided | partial |
| neighborhood | null | null | null | null | null |
| latitude/longitude | null | provided | null | provided | partial |
| website | null | null | null | null | null |
| instagram_handle | null | null | null | null | null |

**Note:** All missing venue data can be enriched via Nominatim + website scraping (FREE, 1 req/sec rate limit).

**Tested enrichment coverage (Buenos Aires venues):**
- Website from OSM: ~67% of major venues have website in OpenStreetMap
- Instagram from OSM: ~0% (rarely added to OSM)
- Instagram from website scrape: ~100% of venues with websites have Instagram links on their sites

### Enrichment Requirements by Source (Venues)

**Note:** Venue enrichment uses Nominatim (OpenStreetMap) which is FREE. The existing implementation in `src/features/venues/api/enrichment.ts` handles address, coordinates, neighborhood mapping, website, and Instagram.

**Enrichment flow:**
1. Query Nominatim with `extratags=1` → get address, neighborhood, website, instagram (if in OSM)
2. If website found but no Instagram → scrape venue website for Instagram links
3. Save all found data to venue

```typescript
// src/features/import/config/venue-enrichment-requirements.ts
export const VENUE_ENRICHMENT_REQUIREMENTS: Record<ImportSource, VenueEnrichmentConfig> = {
  passline: {
    address: { required: true, method: 'nominatim' },
    coordinates: { required: true, method: 'nominatim' },
    neighborhood: { required: true, method: 'nominatim_to_barrio' },
    website: { required: false, method: 'nominatim_extratags' },
    instagram: { required: false, method: 'nominatim_extratags_or_website_scrape' },
  },
  eventbrite: {
    address: { required: false }, // Already has it
    coordinates: { required: false }, // Already has it
    neighborhood: { required: true, method: 'nominatim_to_barrio' },
    website: { required: false, method: 'nominatim_extratags' },
    instagram: { required: false, method: 'nominatim_extratags_or_website_scrape' },
  },
  'ba-tourism': {
    address: { required: true, method: 'nominatim' },
    coordinates: { required: true, method: 'nominatim' },
    neighborhood: { required: true, method: 'nominatim_to_barrio' },
    website: { required: false, method: 'nominatim_extratags' },
    instagram: { required: false, method: 'nominatim_extratags_or_website_scrape' },
  },
  meetup: {
    address: { required: false }, // Usually has it
    coordinates: { required: false }, // Usually has it
    neighborhood: { required: true, method: 'nominatim_to_barrio' },
    website: { required: false, method: 'nominatim_extratags' },
    instagram: { required: false, method: 'nominatim_extratags_or_website_scrape' },
  },
  luma: {
    address: { required: 'conditional', method: 'nominatim' },
    coordinates: { required: 'conditional', method: 'nominatim' },
    neighborhood: { required: true, method: 'nominatim_to_barrio' },
    website: { required: false, method: 'nominatim_extratags' },
    instagram: { required: false, method: 'nominatim_extratags_or_website_scrape' },
  },
  csv: {
    address: { required: false }, // Must pre-exist
    coordinates: { required: false },
    neighborhood: { required: false },
    website: { required: false },
    instagram: { required: false },
  },
}
```

### Backfill Strategy for Existing Records

Existing records imported before automatic enrichment need a catch-up mechanism:

```typescript
// src/features/events/api/backfill-enrichment.ts

// 1. Identify events needing enrichment
export async function getEventsNeedingEnrichment(): Promise<Event[]> {
  const { data } = await supabase
    .from('events')
    .select('*')
    .or('description_es.is.null,description_en.is.null,embedding.is.null')
    .eq('enrichment_status', 'pending')
    .order('starts_at', { ascending: true }) // Prioritize upcoming events
    .limit(100)

  return data || []
}

// 2. Identify venues needing enrichment
export async function getVenuesNeedingEnrichment(): Promise<Venue[]> {
  const { data } = await supabase
    .from('venues')
    .select('*')
    .or('neighborhood.is.null,address.is.null')
    .eq('enrichment_status', 'pending')
    .limit(50)

  return data || []
}

// 3. Run backfill as manual trigger
export async function runEnrichmentBackfill(options: {
  type: 'events' | 'venues' | 'both'
  batchSize?: number
  dryRun?: boolean
}): AsyncGenerator<BackfillProgress> {
  // Process in batches, yielding progress updates
  // Same enrichment logic as automatic enrichment
  // But pulls from existing records instead of just-imported ones
}
```

**Backfill UI in Admin:**
- Add "Enrichment Status" tab to admin dashboard
- Show counts: pending, in_progress, completed, failed
- "Run Backfill" button to process pending records
- Filter events/venues by enrichment status

### Enrichment Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        IMPORT PHASE                              │
│  Source → Fetch → Transform → Venue Match → Insert Events       │
│                                    │                             │
│                    (records created with enrichment_status=pending)
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ENRICHMENT PHASE (Background)                 │
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────┐             │
│  │   EVENT ENRICHMENT  │    │   VENUE ENRICHMENT  │             │
│  │                     │    │                     │             │
│  │ 1. Fetch description│    │ 1. Nominatim lookup │             │
│  │ 2. Translate        │    │ 2. Extract website  │             │
│  │ 3. Generate embed   │    │ 3. Scrape Instagram │             │
│  │ 4. Update status    │    │ 4. Assign barrio    │             │
│  └─────────────────────┘    └─────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKFILL (On-demand)                        │
│                                                                  │
│  Same enrichment logic, but processes existing pending records   │
│  Triggered manually via admin UI                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Notes

The automatic enrichment system should:
1. Track enrichment status per event AND venue (requires Step 1)
2. Run as background jobs after import completes
3. Use source-aware config to determine what needs enrichment
4. Handle retries and rate limiting gracefully
5. Generate embeddings after descriptions are enriched
6. Support backfill mode for existing records
7. Prioritize upcoming events over past events in backfill queue

---

## Step 3: Other Critical Issues

These are independent of automatic enrichment and can be done in parallel with Step 2 or after.

### CRIT-01: Missing `find_similar_venue` RPC Function

**Status:** ✅ Complete
**Location:** `src/features/import/scrapers/venue-matcher.ts:58`
**Impact:** Fuzzy venue matching is completely broken

**Problem:**
The venue matcher calls `supabase.rpc('find_similar_venue', ...)` but this function does not exist in the database. All fuzzy matching fails silently, defaulting to "no match."

**Current Code:**
```typescript
// venue-matcher.ts line 58
const { data: similarVenue } = await supabase.rpc('find_similar_venue', {
  venue_name: normalizedName,
  similarity_threshold: 0.6,
})
```

**Solution:**
Create PostgreSQL function using pg_trgm extension:

```sql
-- Migration: create_find_similar_venue_function
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION find_similar_venue(
  venue_name TEXT,
  similarity_threshold FLOAT DEFAULT 0.6
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    v.name,
    similarity(v.name, venue_name) AS similarity
  FROM venues v
  WHERE similarity(v.name, venue_name) >= similarity_threshold
  ORDER BY similarity DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
```

**Files to Modify:**
- Create new migration in `supabase/migrations/`
- Test in `venue-matcher.ts` after migration

**Notes:**
- The pg_trgm extension may already be enabled for other features
- Consider adding index: `CREATE INDEX venues_name_trgm_idx ON venues USING gin (name gin_trgm_ops);`

---

### CRIT-02: EventStatus Enum Mismatch

**Status:** ✅ Complete
**Location:**
- Database: `supabase/schema.sql` (event_status enum)
- TypeScript: `src/shared/lib/types.ts:56`

**Impact:** Runtime errors when using `past` or `pending_review` statuses

**Problem:**
TypeScript defines statuses that don't exist in the database enum:

```typescript
// types.ts - includes 'past' and 'pending_review'
export type EventStatus = 'scheduled' | 'cancelled' | 'postponed' | 'past' | 'pending_review'
```

```sql
-- schema.sql - only has 3 values
CREATE TYPE event_status AS ENUM ('scheduled', 'cancelled', 'postponed');
```

**Solution Options:**

**Option A (Recommended):** Add missing statuses to database
```sql
ALTER TYPE event_status ADD VALUE 'past';
ALTER TYPE event_status ADD VALUE 'pending_review';
```

**Option B:** Remove from TypeScript (if not needed)
- Search codebase for usage of `past` and `pending_review`
- Remove from type definition if unused

**Investigation Needed:**
- Run: `grep -r "pending_review\|'past'" src/` to find usages
- Determine if these statuses are actively used

**Files to Modify:**
- `supabase/migrations/` (new migration)
- OR `src/shared/lib/types.ts`

---

### CRIT-04: Venue Merge Functionality Not Implemented

**Status:** ✅ Complete (was already working - removed dead code)
**Location:** `src/features/import/hooks/useImportWizard.ts:709-937`
**Impact:** Users can select "merge into" in UI but it's silently ignored

**Update:** Upon investigation, the merge functionality was actually working correctly. The code reads `edit.mergeInto` directly from the venueEdits map when processing events. The `mergeMap` variable was dead code that was created but never used. Fix: Removed the unused `mergeMap` variable for clarity.

**Problem:**
The VenuesStep UI allows users to select a venue to merge into, but the `createVenuesAndProceed` function ignores the `mergeInto` field:

```typescript
// VenueEdit type includes mergeInto
type VenueEdit = {
  originalName: string
  editedName: string
  neighborhood: Neighborhood | null
  skip: boolean
  mergeInto?: string  // <-- This field is captured but never used
}
```

**Current Code (useImportWizard.ts ~line 750):**
```typescript
for (const [originalName, edit] of venueEdits.entries()) {
  if (edit.skip) continue
  if (edit.mergeInto) {
    // TODO: Handle merge case - currently falls through to create
  }
  venuesToCreate.push({ name: edit.editedName, neighborhood: edit.neighborhood })
}
```

**Solution:**
Implement merge logic:

```typescript
const mergeMapping = new Map<string, string>() // originalName -> targetVenueName

for (const [originalName, edit] of venueEdits.entries()) {
  if (edit.skip) continue

  if (edit.mergeInto) {
    // Map original venue name to the target venue name
    mergeMapping.set(originalName, edit.mergeInto)
  } else {
    venuesToCreate.push({
      name: edit.editedName,
      neighborhood: edit.neighborhood,
      type: 'other'
    })
  }
}

// After venue creation, update event matches considering merges
for (const event of previewEvents) {
  const venueName = getVenueName(event)
  const targetName = mergeMapping.get(venueName) || venueName
  const matchedVenue = allVenues.find(v =>
    v.name.toLowerCase() === targetName.toLowerCase()
  )
  if (matchedVenue) {
    event.venueMatch = { venue: matchedVenue, matchType: 'exact', confidence: 1.0 }
    event.transformed.venue_id = matchedVenue.id
  }
}
```

**Files to Modify:**
- `src/features/import/hooks/useImportWizard.ts` (implement merge in createVenuesAndProceed)

**Testing:**
1. Import events with unmatched venues
2. In Venues step, select "Merge into" for one venue
3. Verify events are linked to the merge target, not a new venue

---

## Lower Priority: Architecture Issues

These improve code quality but aren't blocking features.

### ARCH-01: Monolithic Import Wizard Hook (1,680 lines)

**Status:** Not Started
**Location:** `src/features/import/hooks/useImportWizard.ts`
**Impact:** Hard to test, maintain, and extend; violates single responsibility

**Problem:**
Single hook handles all 6 import sources with extensive code duplication:
- Lines 161-253: Source-specific `unmatchedVenues` computation (5 nearly identical blocks)
- Lines 709-937: Source-specific venue creation (5 nearly identical blocks)
- Lines 1036-1306: Source-specific import logic (6 different paths)

**Solution:**
Extract a Source Adapter pattern:

```typescript
// src/features/import/adapters/types.ts
export interface SourceAdapter<TRaw = unknown, TPreview = unknown> {
  source: ImportSource
  getEvents(): TPreview[]
  setEvents(events: TPreview[]): void
  getId(event: TPreview): string
  getVenueName(event: TPreview): string | null
  getTransformed(event: TPreview): EventInsert | EventInsert[]
  shouldAutoCreateVenues: boolean
  supportsDateExpansion: boolean
  fetch(config: SourceConfig): Promise<TPreview[]>
  updateVenueMatch(event: TPreview, venue: Venue): TPreview
}
```

**Files to Create:**
- `src/features/import/adapters/types.ts`
- `src/features/import/adapters/passline-adapter.ts`
- `src/features/import/adapters/eventbrite-adapter.ts`
- `src/features/import/adapters/ba-tourism-adapter.ts`
- `src/features/import/adapters/meetup-adapter.ts`
- `src/features/import/adapters/luma-adapter.ts`
- `src/features/import/adapters/csv-adapter.ts`
- `src/features/import/adapters/index.ts`

**Estimated Effort:** 1-2 days

---

### ARCH-02: Inconsistent Source Handler Patterns

**Status:** Not Started
**Location:** `src/features/import/api/*.ts`
**Impact:** Unpredictable behavior across sources; maintenance burden

**Problem Areas:**
- Venue auto-creation strategy varies by source
- Enrichment input types vary
- Concurrency strategies vary
- Error handling varies

**Solution:**
Standardize with shared config:

```typescript
// src/features/import/config.ts
export const ENRICHMENT_CONFIG = {
  concurrency: 3,
  batchDelayMs: 1000,
  requestTimeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 2000,
}
```

---

## Lower Priority: Data Quality Issues

### DATA-01: Silent AI Categorization Failures

**Status:** Not Started
**Location:** `src/shared/lib/ai/ai-categorizer.ts:36-72`
**Impact:** Events silently get wrong category; user unaware of failures

**Problem:**
When AI categorization fails, it silently defaults to 'social'.

**Solution:**
Return error information alongside result and track fallback count.

---

### DATA-02: Duplicate Detection Only for Meetup

**Status:** Not Started
**Location:** Various import files
**Impact:** Other sources can create duplicates on re-import

**Solution:**
Add duplicate detection to all sources using `checkExistingEvents()` utility.

---

### DATA-03: Weak Similar Venue Detection

**Status:** Not Started
**Location:** `src/features/import/hooks/useImportWizard.ts:255-274`
**Impact:** False positives/negatives in merge suggestions

**Solution:**
Use fuzzy matching with `string-similarity` package instead of simple substring matching.

---

### DATA-04: Price Field Type Inconsistency

**Status:** Not Started
**Location:** Various transformer files
**Impact:** Potential price display errors

**Solution:**
Document and standardize: all prices stored in ARS whole units.

---

## Lower Priority: UX/UI Issues

### UX-01: Generic Error Messages

**Status:** Not Started
**Impact:** Users can't debug or understand what went wrong

**Solution:**
Create error message helper with actionable messages based on error type.

---

### UX-03: No Confirmation Summary Details

**Status:** Not Started
**Impact:** Users can't review exactly which events will be imported

**Solution:**
Add expandable event list in ConfirmStep.

---

## Implementation Progress

### Progress Log

```markdown
### 2026-01-03 - Document Created
**Status:** Complete

Initial documentation of all issues found during system analysis.
10 subagents analyzed different aspects of the import/enrichment system.

### 2026-01-05 - Document Updated for Automatic Enrichment
**Status:** Complete

- Added automatic enrichment architecture with source completeness matrices
- Added CRIT-03 as prerequisite
- Removed issues addressed by automatic enrichment
- Added venue enrichment and backfill strategy

### 2026-01-05 - Nominatim Extratags + Instagram Scraping
**Status:** Complete (Code Implemented)

Enhanced venue enrichment in `src/features/venues/api/enrichment.ts`:
- Added `extratags=1` parameter to Nominatim API calls
- Added `scrapeInstagramFromWebsite()` function
- Tested on Buenos Aires venues: 4/4 websites returned Instagram handles

### 2026-01-05 - Document Reorganized
**Status:** Complete

Reorganized document in optimal implementation order:
1. CRIT-03 (prerequisite) first
2. Automatic enrichment architecture second
3. Other critical issues third
4. Lower priority issues last

### 2026-01-05 - CRIT-03: Enrichment Status Tracking
**Status:** Complete

Implemented database-backed enrichment status tracking:
- Added `enrichment_status` enum type ('pending', 'in_progress', 'completed', 'failed')
- Added `enrichment_status`, `enrichment_error`, `enriched_at` columns to both events and venues
- Created partial indexes for efficient querying of pending records
- Updated TypeScript types in `src/shared/lib/types.ts`
- Updated all enrichment functions to filter by `enrichment_status === 'pending'`
- Updated all enrichment functions to set status on success/failure

**Files Modified:**
- `src/shared/lib/types.ts` - Added EnrichmentStatus type, updated Event/Venue interfaces
- `src/features/venues/api/enrichment.ts` - Updated filters and status updates
- `src/features/events/api/enrichment.ts` - Updated filters and status updates
- `src/features/import/api/luma.ts` - Updated SQL queries and status updates
- `src/features/venues/hooks/useVenueNominatimEnrichment.ts` - Updated canEnrichVenue check
- `src/features/events/hooks/useBackgroundEnrichment.ts` - Updated canEnrichEvent check
- `src/features/events/hooks/useLumaDescriptionEnrichment.ts` - Updated canEnrichEvent check

### 2026-01-05 - Step 2: Automatic Enrichment Architecture
**Status:** Complete

Implemented automatic enrichment that triggers after import completes, plus backfill mechanism:

**Features Implemented:**
1. **Auto-trigger enrichment** - Enrichment starts automatically when import completes (no user action required)
2. **Both events AND venues** - Event descriptions (Jina + Claude → bilingual + embedding) and venue data (Nominatim)
3. **Progress UI** - SummaryStep shows real-time progress bars for events and venues
4. **Stop functionality** - Users can stop enrichment mid-process
5. **Backfill UI** - BackfillCard component in "Needs Attention" tab to enrich existing pending records

**Files Created:**
- `src/features/import/hooks/useAutoEnrichment.ts` - Orchestration hook for both event and venue enrichment
- `src/routes/admin/events/-components/BackfillCard.tsx` - Admin UI for backfill enrichment

**Files Modified:**
- `src/features/events/api/enrichment.ts` - Added `getRecentlyImportedPendingEventsAction`, `getPendingEnrichmentCountsAction`, `getAllPendingEventsAction`
- `src/features/venues/api/enrichment.ts` - Added `getRecentlyCreatedPendingVenuesAction`, `getAllPendingVenuesAction`
- `src/features/import/hooks/useImportWizard.ts` - Added auto-enrichment trigger after import completes
- `src/routes/admin/events/-components/import/SummaryStep.tsx` - Added auto-enrichment progress UI
- `src/routes/admin/events/import.tsx` - Wired autoEnrichmentState to SummaryStep
- `src/routes/admin/events/index.tsx` - Added BackfillCard to "Needs Attention" tab
- `src/features/import/index.ts` - Exported useAutoEnrichment and types
- `src/features/events/index.ts` - Exported new server actions
- `src/features/venues/index.ts` - Exported new server actions

**Architecture:**
- Frontend streaming (client-side), NOT true server-side background jobs
- Events enriched first, then venues
- Progress tracked via `AutoEnrichmentState` with phases: 'idle' | 'events' | 'venues' | 'complete'
- Queries use `enrichment_status: 'pending'` + `created_at >= importStartTime` to identify just-imported records

### 2026-01-05 - Incremental Enrichment Tracking Fix
**Status:** Complete

Fixed enriched/failed counts to update incrementally rather than only at stream completion:
- Previously, enriched count only updated when receiving `complete` message at end of stream
- If user stopped enrichment early, count showed 0 instead of actual enriched count
- Fix: Track counts incrementally by checking `progress.success` on each progress message in both `processEventStream` and `processVenueStream`

**Files Modified:**
- `src/features/import/hooks/useAutoEnrichment.ts` - Added incremental tracking in both stream processors

### 2026-01-05 - Step 3: Critical Issues (CRIT-01, CRIT-02, CRIT-04)
**Status:** Complete

Implemented three critical issues:

**CRIT-01: find_similar_venue RPC Function**
- Created PostgreSQL function with pg_trgm extension for fuzzy venue matching
- Added GIN index on venue names for performance
- Migration: `supabase/migrations/20260105000002_add_find_similar_venue.sql`

**CRIT-02: EventStatus Enum Mismatch**
- Added 'past' and 'pending_review' values to database enum
- Both values were actively used in TypeScript but missing from database
- Migration: `supabase/migrations/20260105000001_add_event_status_values.sql`

**CRIT-04: Venue Merge Dead Code**
- Upon investigation, merge functionality was already working correctly
- Removed unused `mergeMap` variable from `createVenuesAndProceed` function
- Code reads `edit.mergeInto` directly from venueEdits map

**Files Modified:**
- `supabase/migrations/20260105000001_add_event_status_values.sql` - NEW
- `supabase/migrations/20260105000002_add_find_similar_venue.sql` - NEW
- `supabase/schema.sql` - Updated enum + added function
- `src/features/import/hooks/useImportWizard.ts` - Removed dead code
```

---

## Quick Reference

### Files Most Frequently Modified

| File | Issues |
|------|--------|
| `supabase/migrations/` | CRIT-01, CRIT-02, CRIT-03 |
| `src/shared/lib/types.ts` | CRIT-02, CRIT-03 |
| `src/features/import/hooks/useImportWizard.ts` | CRIT-04, ARCH-01, DATA-03 |
| `src/features/venues/api/enrichment.ts` | Auto-enrichment (venues) - IMPLEMENTED |
| `src/features/events/api/backfill-enrichment.ts` | Auto-enrichment (backfill) |

### Commands for Investigation

```bash
# Find all usages of EventStatus
grep -r "EventStatus\|'past'\|'pending_review'" src/

# Find all toast.error calls (for UX-01)
grep -r "toast.error" src/

# Find all venue creation logic
grep -r "createVenue\|bulkCreateVenues" src/

# Find enrichment status references
grep -r "enrichment_status\|EnrichmentStatus" src/
```

### Related Documentation

- `docs/event-import-enrichment.md` - User-facing import guide
- `docs/decisions.md` - Architectural decisions log
- `CLAUDE.md` - Project guidelines
