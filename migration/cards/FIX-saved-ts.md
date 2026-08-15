# Card FIX — saved.ts type error

## Objective

Fix the TypeScript error in `src/features/chat/lib/saved.ts` that `bunx tsc --noEmit` reports.
Do not redesign the module.

## Error (verbatim)

```
src/features/chat/lib/saved.ts(62,10): error TS2345: Argument of type '(item: SavedEventRow) => SavedEventWithDetails | null' is not assignable to parameter of type '(value: { id: any; event_id: any; created_at: any; events: any[]; }, index: number, array: { id: any; event_id: any; created_at: any; events: any[]; }[]) => SavedEventWithDetails | null'.
  Types of parameters 'item' and 'value' are incompatible.
    Type '{ id: any; event_id: any; created_at: any; events: any[]; }' is not assignable to type 'SavedEventRow'.
      Types of property 'events' are incompatible.
        Type 'any[]' is not assignable to type 'Event & { venues: Venue | null; }'.
```

Cause: the untyped Supabase client infers the `events (...)` join as `any[]`. `mapSavedEventRow` expects a single nested object.

## Required change

Keep behavior identical. Cast or normalize the join result so `mapSavedEventRow` still receives one event (or null). Prefer a narrow type assertion / unwrap-array helper over `any`. Do not add dependencies. Do not change query semantics.

## Acceptance

1. `bunx tsc --noEmit` — zero errors in `src/features/chat/lib/saved.ts`. Other errors outside this file are not yours.
2. `bunx vitest run src/features/chat/lib` — still green.
3. Write `migration/evidence/FIX-saved-ts.md` per CONTRACTS.md §10.

## Boundaries

Only `src/features/chat/lib/saved.ts` and the evidence file. No git. No deps. No other files.
