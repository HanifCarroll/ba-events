# Card FIX — saved.ts type error — evidence

## Scope done

- `src/features/chat/lib/saved.ts`
  - Fixed `TS2345` by adding a narrow `as unknown as SavedEventRow[]` assertion on the
    `getSavedEvents()` query result before mapping. No behavior change: the untyped
    Supabase client infers the `events (...)` join as `any[]`, but
    `saved_events.event_id -> events.id` is a many-to-one FK, so PostgREST returns a single
    nested object (or null) — matching the existing `mapSavedEventRow` expectation. The
    legacy file did the equivalent via `as any` on the whole query.

## Commands + outputs

### `bunx tsc --noEmit` (filtered for this file)

```
$ bunx tsc --noEmit 2>&1 | grep "saved.ts"
NO saved.ts errors   # grep -c "saved.ts" → 0
```

Zero errors in `src/features/chat/lib/saved.ts`. Full `tsc` still reports the following
pre-existing errors in files owned by other cards (outside this card's boundary):

```
src/shared/ui/badge/index.ts(1,21): error TS2614: Module '"*.svelte"' has no exported member 'BadgeVariant'. Did you mean to use 'import BadgeVariant from "*.svelte"' instead?
src/shared/ui/badge/index.ts(1,35): error TS2614: Module '"*.svelte"' has no exported member 'badgeVariants'. Did you mean to use 'import badgeVariants from "*.svelte"' instead?
src/shared/ui/button/index.ts(2,7): error TS2614: Module '"*.svelte"' has no exported member 'ButtonProps'. Did you mean to use 'import ButtonProps from "*.svelte"' instead?
src/shared/ui/button/index.ts(3,7): error TS2614: Module '"*.svelte"' has no exported member 'ButtonSize'. Did you mean to use 'import ButtonSize from "*.svelte"' instead?
src/shared/ui/button/index.ts(4,7): error TS2614: Module '"*.svelte"' has no exported member 'ButtonVariant'. Did you mean to use 'import ButtonVariant from "*.svelte"' instead?
src/shared/ui/button/index.ts(5,2): error TS2614: Module '"*.svelte"' has no exported member 'buttonVariants'. Did you mean to use 'import buttonVariants from "*.svelte"' instead?
```

### `bunx vitest run src/features/chat/lib`

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit

 Test Files  7 passed (7)
      Tests  27 passed (27)
   Start at  13:28:26
   Duration  308ms (transform 208ms, setup 0ms, import 321ms, tests 39ms, environment 2ms)
```

## Deviations

- None. Behavior is identical; the legacy file suppressed this with `as any` on the whole
  query, while the port uses a narrow `as unknown as SavedEventRow[]` assertion (no `any`).

## Cross-import debts

- None introduced by this card. The remaining `tsc` errors are in
  `src/shared/ui/badge/index.ts` and `src/shared/ui/button/index.ts`, owned by other cards.

## TODOs

- None.
