# Public Event MCP Specification

## Purpose
Define the stateless public MCP search and event-detail boundary, including its allowlisted output and fail-closed anonymous rate limiting.

## Requirements

### Requirement: MCP exposes two read-only tools
The public server SHALL expose only `search_events` and `get_event`, both annotated as read-only and idempotent. It MUST NOT expose internal mutation, chat, or database tools.

#### Scenario: Client lists tools
- **WHEN** MCP initialization completes
- **THEN** only the two public event reads are available

### Requirement: Public inputs and outputs are allowlisted
Tool inputs MUST pass strict bounded schemas. Output MUST be constructed by the public DTO mapper and MUST NOT leak internal venue ids, embeddings, operational fields, or hidden addresses.

#### Scenario: Hidden-location event is returned
- **WHEN** its public DTO is created
- **THEN** the venue address field is omitted

### Requirement: Detail returns displayable events only
`get_event` MUST return only a currently displayable event. Missing, invalid, or non-displayable ids SHALL use the bounded not-available response.

#### Scenario: Cancelled event id is requested
- **WHEN** storage resolves a non-displayable record
- **THEN** the tool returns no event and marks the result as an error

### Requirement: Anonymous tool calls fail closed under rate-limit uncertainty
Tool calls SHALL use the configured anonymous rate limiter. A rejected limit or limiter failure MUST return 429 with retry guidance rather than permit the call.

#### Scenario: Rate limiter throws
- **WHEN** a tools/call request cannot be checked
- **THEN** the worker returns 429 and does not execute the tool

### Requirement: Transport is bounded
The worker SHALL reject oversized requests, unknown routes, and disallowed host origins and SHALL apply a fixed tool timeout.

#### Scenario: A read times out or its caller cancels
- **WHEN** a public MCP read reaches its deadline or its HTTP/protocol caller cancels
- **THEN** its search/database requests receive the combined cancellation signal
- **AND** late successful data cannot become a public result
- **AND** the existing bounded tool-error response is retained without retrying the read

#### Scenario: Request exceeds the byte limit
- **WHEN** Content-Length is above the configured maximum
- **THEN** the worker returns 413 before MCP execution

## Verification

### Implementation anchors
- `src/mcp-worker/index.ts`
- `src/mcp-worker/public.ts`
- `wrangler.mcp.jsonc`

### Deterministic tests
- `src/mcp-worker/index.test.ts`

### Verification command
```sh
bunx vitest run src/mcp-worker/index.test.ts
```

### Advisory conformance review
`$openspec-review-conformance public-event-mcp` is advisory rather than proof.
