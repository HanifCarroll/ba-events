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

### Requirement: Unknown facts remain unknown
Time-TBA, location-TBA, missing price, missing description, and missing source data MUST use their explicit presentation states and MUST NOT be replaced with invented values.

#### Scenario: Source provides no verified time
- **WHEN** an event is marked time TBA
- **THEN** presentation does not describe midnight as the event time

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

### Deterministic tests
- `src/features/events/lib/location-presentation.test.ts`
- `src/features/events/lib/source-presentation.test.ts`
- `src/features/events/lib/description-presentation.test.ts`
- `src/features/events/lib/event-summary.test.ts`

### Verification command
```sh
bunx vitest run src/features/events/lib/location-presentation.test.ts src/features/events/lib/source-presentation.test.ts src/features/events/lib/description-presentation.test.ts src/features/events/lib/event-summary.test.ts
```

### Advisory conformance review
`$openspec-review-conformance event-catalog-provenance` is advisory rather than proof.
