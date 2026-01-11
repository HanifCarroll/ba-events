# Venue Management

This document covers venue administration features including duplicate detection and merging.

## Venue Deduplication

When events are imported from multiple sources, duplicate venues often get created with slightly different names (e.g., "Teatro Colón" vs "Teatro Colon" vs "Colón Teatro"). The venue merge feature helps administrators consolidate these duplicates.

### How Duplicate Detection Works

The system uses PostgreSQL's `pg_trgm` extension for fuzzy text matching between venue names.

**Algorithm:**
1. Compare all venue pairs using trigram similarity on names
2. Return pairs with similarity score ≥ threshold (default 0.5)
3. Exclude pairs that share the same parent venue (intentional relationships)
4. Exclude pairs previously dismissed as "not duplicates"

**Similarity Threshold:**
- `0.5` (default): Catches most duplicates while minimizing false positives
- `0.3`: More aggressive - catches more but may include false positives
- `0.7`: More conservative - higher confidence matches only

### Database Functions

#### `get_duplicate_venue_candidates(similarity_threshold FLOAT)`

Finds potential duplicate venue pairs.

**Returns:**
| Column | Type | Description |
|--------|------|-------------|
| venue_id | UUID | First venue ID |
| venue_name | TEXT | First venue name |
| venue_neighborhood | neighborhood | First venue neighborhood |
| similar_venue_id | UUID | Second venue ID |
| similar_venue_name | TEXT | Second venue name |
| similar_venue_neighborhood | neighborhood | Second venue neighborhood |
| similarity_score | FLOAT | Similarity score (0.0 to 1.0) |

**Example:**
```sql
SELECT * FROM get_duplicate_venue_candidates(0.5);
```

#### `merge_venues(source_venue_id UUID, target_venue_id UUID)`

Merges two venues by reassigning all events from the source to the target, then deleting the source.

**Process:**
1. Validates both venues exist
2. Updates all events to point to target venue
3. Deletes the source venue
4. Cleans up any dismissed duplicate pairs involving the source

**Returns:** JSON object with merge results
```json
{
  "success": true,
  "events_reassigned": 5,
  "deleted_venue_id": "uuid-of-deleted-venue",
  "deleted_venue_name": "Duplicate Venue Name",
  "target_venue_id": "uuid-of-kept-venue",
  "target_venue_name": "Canonical Venue Name"
}
```

### Dismissed Duplicates Table

When administrators mark a pair as "not duplicates," the pair is stored in `dismissed_venue_duplicates` so it won't appear in future duplicate scans.

**Schema:**
```sql
dismissed_venue_duplicates (
  id UUID PRIMARY KEY,
  venue_id_1 UUID,  -- Always the smaller UUID
  venue_id_2 UUID,  -- Always the larger UUID
  dismissed_by UUID,
  dismissed_at TIMESTAMPTZ
)
```

### Admin UI Workflow

1. **Navigate to Venues > Duplicates tab**
   - Shows grouped duplicate candidates with similarity scores
   - Each group displays event counts per venue

2. **Expand a duplicate group**
   - View events at each venue with names, dates, and external links
   - Review to determine which venue is canonical

3. **Choose action:**
   - **Merge:** Select which venue to keep via radio buttons, click "Merge Venues"
   - **Dismiss:** Click "Not a duplicate" to hide the pair from future scans

4. **After merge:**
   - All events transferred to kept venue
   - Deleted venue removed from database
   - UI refreshes to show updated duplicate list

### Code Architecture

**Server Functions** (`src/features/venues/api/review.ts`):
- `getDuplicateVenueCandidatesAction()` - Calls RPC function
- `mergeVenuesAction()` - Calls RPC function
- `getVenueEventsAction()` - Fetches events for preview
- `dismissDuplicatePairAction()` - Inserts into dismissed table

**UI Components** (`src/routes/admin/venues/-components/`):
- `VenueDuplicatesPanel.tsx` - Main duplicates tab content
- `MergeVenueDialog.tsx` - Modal for choosing venue to keep

### Best Practices

1. **Review events before merging** - Expand the event lists to verify venues are truly duplicates
2. **Keep the venue with more complete data** - Prefer venues with neighborhood, address, and website
3. **Check external links** - Events have links to original sources for verification
4. **Use dismiss liberally** - False positives are common; dismissing cleans up the list

### Migration

The database functions were added in migration `20260111174703_add_venue_merge_functions.sql`.
