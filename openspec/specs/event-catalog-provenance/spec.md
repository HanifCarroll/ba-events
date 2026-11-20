# Event Catalog and Provenance Specification

## Purpose
Define which events are publicly displayable and how event facts, locations, descriptions, and source links are presented without overstating evidence.

## Requirements

### Requirement: Public reads expose displayable events only
Public event lists, details, follow-up context, and external reads MUST exclude records whose status is not displayable.

#### Scenario: Cancelled event is requested
- **WHEN** a public surface resolves a cancelled or otherwise non-displayable event
- **THEN** it returns no public event

### Requirement: Hidden locations remain hidden
When an event marks its location hidden, public presentation MUST NOT expose its venue address while MAY retaining the safe venue name or neighborhood.

#### Scenario: Hidden-location event is rendered
- **WHEN** event detail or an external DTO is built
- **THEN** the private address is omitted

#### Scenario: Concierge reads a hidden or unconfirmed event location
- **WHEN** a concierge search, event-detail or saved-list read returns a hidden or location-TBA event
- **THEN** model-facing facts, previews and canonical cards omit its stored venue address
- **AND** the event does not issue a venue reference that bypasses its location state
- **AND** event directions fail with an explicit unavailable-location result without a map URL

#### Scenario: A previous or pinned event supplies a venue handle
- **WHEN** a concierge uses a venue handle owned by a previous or pinned event
- **THEN** venue details and directions check that event's current location availability
- **AND** hidden or unconfirmed event locations do not fall back to an independent venue-address lookup

### Requirement: Unknown facts remain unknown
Time-TBA, location-TBA, missing price, missing description, and missing source data MUST use their explicit presentation states and MUST NOT be replaced with invented values.

#### Scenario: Source provides no verified time
- **WHEN** an event is marked time TBA
- **THEN** presentation does not describe midnight as the event time

#### Scenario: Source has zero or missing admission price
- **WHEN** a concierge read formats an event with a stored zero price or an explicit free flag
- **THEN** its price is presented as free, consistently with the event card
- **AND** a missing price without an explicit free flag remains unknown

#### Scenario: Concierge receives an event with an unverified time
- **WHEN** a successful concierge read returns an event marked time TBA
- **THEN** model-facing event facts contain its Buenos Aires calendar date and the time-TBA flag
- **AND** model-facing facts omit a start time and end time
- **AND** canonical cards retain the source timestamps and time-TBA flag for their existing presentation rules

### Requirement: Event structured data reflects known catalog facts
Event detail JSON-LD SHALL use recorded times, status, admission facts, and visible venue facts. It SHALL include stored organizers, performers, door times, and sale opening times where applicable. It SHALL NOT infer credits from the venue or supply an unknown ticket availability or end date.

#### Scenario: Event detail includes a confirmed venue
- **WHEN** the event has a visible, confirmed venue
- **THEN** the Place uses the stored name and address without placeholder text; a hidden or unconfirmed location does not expose its venue details
- **AND** a venue does not stand in for a missing organizer

#### Scenario: A scheduled or postponed event has known admission or a ticket link
- **WHEN** a scheduled or postponed event has a usable ticket or registration link, or has a recorded price or free flag and is not pay-what-you-can
- **THEN** JSON-LD includes an `Offer` without ticket availability
- **AND** the offer includes a URL only when there is a usable ticket or registration link
- **AND** the offer includes the recorded price in `ARS`, or `0` in `ARS` for free events, and omits price and currency when unknown
- **AND** the BA Tourism `ticket_url` is treated as an information link, never as an admission link

#### Scenario: Admission is a variable contribution
- **WHEN** the agenda's contribution rules recognize pay-what-you-can admission from the listing or the retained price note
- **THEN** JSON-LD omits price and currency and does not claim free admission, even with a recorded price or free flag
- **AND** a scheduled or postponed event gets an offer only if it has a usable ticket or registration link

#### Scenario: No current offer is supported by the catalog
- **WHEN** an event is past, canceled, or pending review, or it has no usable admission link, recorded price, or free flag
- **THEN** JSON-LD omits `offers`

#### Scenario: The event has no precise start time or a changed status
- **WHEN** the event is date-only or time TBA
- **THEN** its start and any recorded end are Buenos Aires calendar dates
- **AND** JSON-LD omits `endDate` when no end is recorded
- **AND** a Luma event with known hours keeps its times even if flagged all-day because of its duration
- **AND** cancellation and postponement map to their corresponding schema statuses without changing the date or location

#### Scenario: A source states credits or door times
- **WHEN** event details include a stored organizer, performer lineup, or door time
- **THEN** the event page shows the credited people and identifies doors separately from the performance start, including the local door date when it differs from the event date
- **AND** JSON-LD uses `doorTime` without treating it as the performance start, and includes a sale opening time only on an offer with a usable ticket or registration link

### Requirement: Source presentation preserves provenance
Event detail and summaries SHALL distinguish BA Eventos pages, original event sources, and ticket links using the stored source fields. Sanitization or summary generation MUST NOT create a source URL.

#### Scenario: Event has an original source link
- **WHEN** source presentation is built
- **THEN** the link remains identified as external source evidence rather than BA Eventos-authored fact

### Requirement: The homepage reads the in-scope agenda from a shared cache
The homepage SHALL load scheduled events with `events.scope = 'in'`, from the start of the current Buenos Aires date through the next six local dates, soonest first. Events SHALL have a non-empty catalog image URL. An intake link or description SHALL NOT be required. The query MAY also load the first four in-scope scheduled events after this window for labeled date-filter fallbacks. Hidden or unconfirmed venue data SHALL NOT be exposed. The view SHALL render in server HTML even on a cache miss.

#### Scenario: An event awaits classification or is out of scope
- **WHEN** an event has NULL or `'out'` scope
- **THEN** it appears in neither the weekly agenda nor the date-filter fallback

#### Scenario: An otherwise eligible event lacks artwork
- **WHEN** its catalog image URL is NULL or empty
- **THEN** it appears in neither the weekly agenda nor the date-filter fallback

#### Scenario: A new Buenos Aires date begins
- **WHEN** the seven-day window rolls over
- **THEN** the server SHALL use a cache key for the new local date
- **AND** within that date, cached cards are fresh for 60 seconds and MAY be served for a further 300 seconds while a retained background refresh runs
- **AND** a failed refresh MUST NOT be cached as a successful empty feed

#### Scenario: An agenda event has doors but no known start
- **WHEN** an upcoming occurrence has a door time and its start is time TBA
- **THEN** the row shows localized door time instead of time TBA, including the local door date if different, and uses the door timestamp for ordering within the advertised Buenos Aires date
- **AND** these choices do not change the stored start date or publish a guessed start

#### Scenario: An agenda card has linked evidence
- **WHEN** an event has a valid stored Instagram post URL linked through intake evidence
- **THEN** its card offers that original post as a secondary link, not a ticket action

#### Scenario: A client uses the legacy compact feed
- **WHEN** the client requests `/api/events/happening-soon`
- **THEN** the endpoint retains the compact public fields and four-card limit, from the same scoped weekly feed, starting at least 12 hours out
- **AND** its browser/CDN policy does not extend the intended browser freshness to the zone's four-hour minimum

### Requirement: Event artwork is bounded and responsive across sources
Passline, Venti, Meetup, Eventbrite, and Luma artwork SHALL use the same catalog-mediated responsive WebP delivery path. BA Tourism records without source images SHALL retain their existing missing-image presentation. Transformations SHALL preserve aspect ratio, avoid upscaling, use fixed 320/640/1280-pixel variants, and retain original-image fallback on unavailable transformations or quota exhaustion. The first four homepage cards SHALL load eagerly, only the first SHALL have high fetch priority, and farther cards SHALL remain lazy.

#### Scenario: An image transformation is requested
- **WHEN** a caller provides a displayable catalog event ID and a supported variant
- **THEN** the server resolves its stored artwork, allows only exact known media hosts and paths over HTTPS, downloads anonymously without following redirects, bounds bytes and decoded dimensions, and caches only successful derived images

#### Scenario: An arbitrary proxy target is supplied
- **WHEN** an image request supplies an upstream URL, unsupported size, invalid event ID, obsolete version, or unapproved origin
- **THEN** it MUST NOT fetch or transform that arbitrary target

#### Scenario: Transformation is unavailable
- **WHEN** the image service or its free allowance is unavailable
- **THEN** the original approved source image remains available and the fallback MUST NOT be cached as a successful derivative

#### Scenario: Instagram supplies selected retained artwork
- **WHEN** a displayable event references a retained public artwork object
- **THEN** the same finite-size delivery path permits only the configured storage origin and content-hash artwork path
- **AND** it does not permit private evidence paths, other storage projects, arbitrary query parameters or expiring Instagram CDN links
- **AND** Instagram remains identified as the original source rather than a ticket seller

#### Scenario: Artwork stored in R2 on a Worker that binds D1
- **WHEN** a displayable event's artwork URL is `https://baeventos.com/api/event-artwork/<event id>/<sha256>.<ext>` (the form the D1 copy and the D1 intake write) and the Worker binds the `ARTWORK` bucket
- **THEN** that path serves the stored original from R2 with an immutable one-year cache, only while it is that event's current artwork and only with a JPEG, PNG, or WebP content type
- **AND** the finite-size variants read the same object from R2 instead of fetching a URL, and fall back to that original path on this host

#### Scenario: A small original is selected through a larger cached candidate
- **WHEN** no-upscale delivery returns fewer physical pixels than the requested variant and candidate selection changes
- **THEN** artwork in a reserved aspect-ratio frame retains its rendered size independently of density-corrected natural dimensions, remains uncropped, and caps candidate descriptors to known source widths without duplicate variants

### Requirement: Public discovery lists only in-scope events
The D1 catalog SHALL judge events individually for an independent and public culture agenda, regardless of source, ticketing platform, or genre. `events.scope` is `'in'`, `'out'`, or NULL; public lists show only `'in'`. This applies to the homepage feed, chat, Telegram, MCP search, and Instagram publishing. Direct event URLs retain their existing detail rules regardless of scope.

#### Scenario: The same genre appears in a live show and a party
- **WHEN** independent artists play a small-room trap or metal concert and another listing advertises a club DJ party
- **THEN** the concert can be in scope and the party is out, regardless of who posted either event

#### Scenario: A judgment is missing or no longer current
- **WHEN** a scheduled event is new or its classification facts change
- **THEN** the hourly catalog task attempts a bounded batch of judgments without a new cron
- **AND** an invalid or failed model response never makes an event public, while an ambiguous event is judged out with an `unclear:` reason

#### Scenario: A catalog venue name is edited
- **WHEN** a venue's new name has the same normalized key used by venue matching and its neighborhood is unchanged
- **THEN** events retain their existing scope judgments
- **AND** a different normalized key or neighborhood clears the linked judgments without changing event revisions

#### Scenario: A batch includes recently cleared judgments
- **WHEN** the hourly task selects events whose judgments were cleared in the last two hours
- **THEN** it judges those rows ahead of other pending judgments, newest clear first
- **AND** the operator backfill retains its stable start-time and ID order

#### Scenario: A Passline description or caption matches the fixed ticket-sale template
- **WHEN** a Passline description or caption exactly matches the full template for the stored title after HTML entity, case, and whitespace normalization
- **THEN** the catalog sends the listing to the model with only the matching fields set to null
- **AND** the title, venue, categories, facets, and any nonmatching descriptions or captions remain unchanged
- **AND** generic ticket-sale copy is not evidence of what the event is

#### Scenario: An operator rehearses the backfill
- **WHEN** the operator requests a dry run for scheduled events starting today or later in Buenos Aires
- **THEN** the command reports the judgments without writing them; applying judgments is explicit and rerunning skips current judgments

## Verification

### Implementation anchors
- `src/features/events/api/detail.server.ts`
- `src/features/events/lib/event-detail-data.ts`
- `src/features/events/lib/location-presentation.ts`
- `src/features/events/lib/source-presentation.ts`
- `src/features/events/lib/description-presentation.ts`
- `src/features/events/api/home-feed.server.ts`
- `src/features/events/api/artwork.server.ts`
- `src/features/chat/api/agent/orchestrate.ts`
- `src/features/chat/api/tools/get-directions.ts`
- `src/features/chat/api/tools/utils.ts`
- `src/shared/lib/db/client.server.ts`
- `src/shared/lib/db/event-reads-d1.server.ts`

### Deterministic tests
- `src/features/events/lib/location-presentation.test.ts`
- `src/features/events/lib/source-presentation.test.ts`
- `src/features/events/lib/description-presentation.test.ts`
- `src/features/events/lib/event-summary.test.ts`
- `src/routes/home-loading.test.ts`
- `src/features/events/api/home-feed.server.test.ts`
- `src/features/events/lib/home-agenda.test.ts`
- `src/features/events/api/artwork.server.test.ts`
- `src/features/events/lib/artwork-delivery.test.ts`
- `src/shared/lib/db/event-reads-d1.server.test.ts`
- `src/features/chat/api/tools/presentation.test.ts`
- `src/features/chat/api/agent/orchestrate.test.ts`

### Verification command
```sh
bunx vitest run src/features/events/lib/location-presentation.test.ts src/features/events/lib/source-presentation.test.ts src/features/events/lib/description-presentation.test.ts src/features/events/lib/event-summary.test.ts
```

### Advisory conformance review
`$openspec-review-conformance event-catalog-provenance` is advisory rather than proof.
