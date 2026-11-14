# Web Origin Routing Specification

## Purpose
Keep local development requests on their requested origin while canonicalizing deployed web requests.

## Requirements

### Requirement: Development requests retain their origin
When the SvelteKit development server is running, the web request hook MUST resolve requests without redirecting them to the public domain.

#### Scenario: Local development page request
- **WHEN** a development request reaches `http://localhost:3001/` or a loopback address
- **THEN** the app renders on that origin without a canonical-domain redirect

### Requirement: Deployed requests use the canonical origin
Outside development, HTTP or non-canonical-host requests MUST receive a permanent redirect to HTTPS on `baeventos.com`, preserving the path and query. Requests already on the HTTPS apex MUST resolve without a canonical-origin redirect.

#### Scenario: HTTP or www request
- **WHEN** a deployed request uses HTTP or the `www.baeventos.com` hostname
- **THEN** the hook returns a 301 redirect to the HTTPS apex with the same path and query

#### Scenario: Canonical request
- **WHEN** a request uses `https://baeventos.com`
- **THEN** the hook resolves the request

## Verification
- Implementation: `src/hooks.server.ts`
- Deterministic tests: `src/hooks.server.test.ts`, `src/hooks.server.dev.test.ts`
- Command: `bunx vitest run src/hooks.server.test.ts src/hooks.server.dev.test.ts`
