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

### Requirement: Source presentation preserves provenance
Event detail and summaries SHALL distinguish BA Eventos pages, original event sources, and ticket links using the stored source fields. Sanitization or summary generation MUST NOT create a source URL.

#### Scenario: Event has an original source link
- **WHEN** source presentation is built
- **THEN** the link remains identified as external source evidence rather than BA Eventos-authored fact

## Verification

### Implementation anchors
- `src/features/events/api/detail.server.ts`
- `src/features/events/lib/event-detail-data.ts`
- `src/features/events/lib/location-presentation.ts`
- `src/features/events/lib/source-presentation.ts`
- `src/features/events/lib/description-presentation.ts`
- `src/features/chat/api/agent/orchestrate.ts`
- `src/features/chat/api/tools/get-directions.ts`
- `src/features/chat/api/tools/utils.ts`
- `src/shared/lib/db/client.server.ts`

### Deterministic tests
- `src/features/events/lib/location-presentation.test.ts`
- `src/features/events/lib/source-presentation.test.ts`
- `src/features/events/lib/description-presentation.test.ts`
- `src/features/events/lib/event-summary.test.ts`
- `src/features/chat/api/tools/presentation.test.ts`
- `src/features/chat/api/agent/orchestrate.test.ts`

### Verification command
```sh
bunx vitest run src/features/events/lib/location-presentation.test.ts src/features/events/lib/source-presentation.test.ts src/features/events/lib/description-presentation.test.ts src/features/events/lib/event-summary.test.ts
```

### Advisory conformance review
`$openspec-review-conformance event-catalog-provenance` is advisory rather than proof.
