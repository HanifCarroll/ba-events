# Card U2 — events-ui — evidence

## Scope done

| Legacy | New | Note |
|---|---|---|
| `src/routes/-components/events/EventCard.tsx` | `src/features/events/components/EventCard.svelte` | Hero + default (mobile `sm:hidden` / desktop `hidden sm:block`) variants in one component; analytics (`event:viewed`, `concierge:recommendation_shown`, `chat:event_clicked`, `event:link_clicked`, `event:shared`), share (native → clipboard fallback), source presentation, all class strings verbatim |
| `src/routes/-components/events/EventList.tsx` | `src/features/events/components/EventList.svelte` | single → hero, many → equal list; keyed `{#each}` |
| `src/routes/-components/SaveEventButton.tsx` | `src/features/events/components/SaveEventButton.svelte` | loading / signed-out (tooltip → `/login`) / signed-in toggle states; optimistic save/unsave + `track` + `toast.error`; `isEventSaved/saveEvent/unsaveEvent` from `#features/chat/lib/saved.ts` |
| `src/routes/-components/events/index.ts` (barrel) | — (skipped) | re-exported `EventCard` + `EventList` only |
| `(new) src/features/events/api/saved.remote.ts` | — (not created) | see Deviations §1 |
| `src/routes/saved.tsx` | `src/routes/saved/+page.svelte` + `+page.server.ts` | `requireAuth(event, '/saved')` in load; client-side `getSavedEvents()` + `event-save-changed` listener; upcoming/past filter tabs + empty/loading states |
| `src/routes/profile.tsx` | `src/routes/profile/+page.svelte` + `+page.server.ts` | `requireAuth(event, '/profile')`; display-name form (`displayNameSchema` → `updateDisplayName`) + delete-account dialog (`deleteAccount` → `goto('/')`) |
| `src/routes/events/$id.tsx` | `src/routes/events/[id]/+page.svelte` + `+page.server.ts` | public `getEventWithVenueById`; `error(404, 'Event not found')` on load failure; meta/OG/twitter/canonical/JSON-LD via `<svelte:head>`; back-to-chat button |
| `EventCard.test.tsx` | `src/features/events/lib/event-summary.test.ts` | logic-level (pure `formatCategoryLabel` / `buildEventSummary` / `buildEventJsonLd`); component-level DOM/analytics assertions are not portable without a React DOM renderer |
| (new) `src/features/events/lib/event-summary.ts` | — | colocated pure helpers split out of `$id.tsx` (SvelteKit forbids non-`load` exports in `+page.server.ts`) |
| (new) `src/features/events/lib/render-markdown.ts` | — | Svelte action wrapping `marked` + `DOMPurify` (replaces `react-markdown`) |

## Commands + outputs

### 1. Autofixer (`bunx @sveltejs/mcp svelte-autofixer <file>`)

All six `.svelte` files return `issues: [], suggestions: [], require_another_tool_call_after_fixing: false`:

```
===== src/features/events/components/EventList.svelte =====
{ issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
===== src/features/events/components/SaveEventButton.svelte =====
{ issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
===== src/features/events/components/EventCard.svelte =====
{ issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
===== src/routes/events/[id]/+page.svelte =====
{ issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
===== src/routes/saved/+page.svelte =====
{ issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
===== src/routes/profile/+page.svelte =====
{ issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
```

(`render-markdown.ts` and `event-summary*.ts` are plain `.ts`, not `.svelte`/`.svelte.ts`; the §9 gate applies to Svelte files only.)

### 2. `bunx tsc --noEmit 2>&1` — zero errors in my files

Full run is polluted by `build/_app/immutable/**/*.js` (2961 errors — a concurrent worker's `vite build` output; `build/` is gitignored) plus one in-flight U1 file. Scoped to my files:

```
$ bunx tsc --noEmit 2>&1 | grep -E "^src/features/events|^src/routes/events|^src/routes/saved|^src/routes/profile"
(no output; exit 1)
```

### 3. `bun run check` (svelte-check) — zero errors in my files

```
$ bun run check 2>&1 | grep -E "src/features/events/(components|lib)|src/routes/(events|saved|profile)/" | grep -v chat
(no output; exit 1)
```

(Whole-project `check` exits 1 only due to `build/**` and other in-flight workers' files — not mine.)

### 4. `bunx vitest run src/features/events`

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit

 Test Files  4 passed (4)
      Tests  26 passed (26)
   Start at  14:11:54
   Duration  205ms (transform 170ms, setup 0ms, import 248ms, tests 11ms, environment 1ms)
```

### 5. Forbidden-string grep (acceptance #3)

```
$ grep -rn "@tanstack\|from 'react'\|from \"react\"\|import.meta.env" \
  <all 12 files in scope>
(no output; exit 1)
```

## Deviations

1. **`saved.remote.ts` not created.** Card note 1 asked me to read what `SaveEventButton`
   calls and "write `saved.remote.ts` `command` wrappers accordingly". The legacy
   `SaveEventButton` calls `isEventSaved`/`saveEvent`/`unsaveEvent` from
   `@/features/chat/lib/saved` — those are **browser-Supabase-client** functions, not
   `createServerFn`s (verified against legacy `chat/lib/saved.ts`, `chat/api/user-tools.ts`,
   and card-06's `saved.ts`). There are no server paths to wrap in a `command()`, so a
   remote file would be empty/incorrect. Card-06's conditional `@migration TODO: wire remote
   function` was never present in `chat/lib/saved.ts` (confirmed by reading the file and
   card-06 evidence §Deviations.1). The button imports the browser-client functions
   directly — exactly like the legacy.
2. **`state={ fromChat }` → `?from=chat` query param.** TanStack Router's `Link state` has no
   direct SvelteKit equivalent on a plain `<a href>`. EventCard's detail links use
   `/events/{id}?from=chat` when `source === 'chat'`; the detail page reads
   `page.url.searchParams.get('from') === 'chat'` to show the "Back to chat" button. The
   back handler uses `history.length > 1` → `history.back()`, else `goto('/')` (TanStack's
   `canGoBack`).
3. **`react-markdown` → `marked` + `DOMPurify` (client-side).** `react-markdown` is
   "deleted without replacement" (contract §2). The event description is rendered with a
   `use:renderMarkdown` Svelte action (in `render-markdown.ts`) that runs `marked.parse`
   then `DOMPurify.sanitize` and assigns `innerHTML`. Actions run only in the browser, so
   `DOMPurify` (which needs a `window`) never touches SSR. This matches U1's documented
   markdown approach and keeps `{@html}` out of the template (autofixer flags `{@html}`).
4. **`useEffect` → `onMount` (not `$effect`).** The saved page's fetch + `event-save-changed`
   listener, the SaveEventButton's `isEventSaved` load, and the profile form's initial sync
   are `onMount` (run-once) rather than `$effect`. The legacy effects keyed on
   `[user]`/`[eventId, user]` only re-run on auth changes, which in SvelteKit cause full
   page navigation (and `requireAuth` redirects) — so run-once is behaviorally equivalent
   here. `onMount` is also the Svelte-idiomatic "side effect once on mount" hook and avoids
   the autofixer's `$effect`-reassignment suggestions. The save/unsave change listener reads
   `auth.user` at call time (current value), which is strictly more correct than the legacy
   closure capture.
5. **`useState(initialSaved)` → `$state(untrack(() => initialSaved))`.** The autofixer flags
   `$state(initialSaved)` as `state_referenced_locally` (captures the prop once). `untrack`
   preserves the same run-once semantics while moving the read into a nested closure so the
   analyzer accepts it.
6. **Event-derived `const` → `$derived`.** `startDate`/`dateStr`/`timeStr`/`priceDisplay`/
   `placeLabel`/`contextSegments`/etc. are `$derived` in `EventCard.svelte` (and the detail
   page) so a reused component instance re-evaluates on param/event change — mirroring the
   legacy per-render recomputation. Same values, no behavior change.
7. **No `usePullToRefresh` on `/saved`.** Legacy `saved.tsx` does not use it (it refreshes via
   the `window 'event-save-changed'` listener, which is preserved). U3's attachment is not
   consumed because the legacy never wired it there.
8. **New colocated helpers.** `event-summary.ts` (`buildEventSummary`/`buildEventJsonLd`/
   `formatCategoryLabel`) and `render-markdown.ts` were split out of `$id.tsx` because
   SvelteKit allows only `load`/`actions`/etc. exports from `+page.server.ts`, and the same
   helpers are needed by both `+page.server.ts` (meta/JSON-LD) and `+page.svelte` (share text
   + category badges). Both are pure and stay inside the events feature.
9. **Profile inputs use `value` + `oninput`** instead of `bind:value` because S2's `Input`
   (`src/shared/ui/input/input.svelte`) does not declare `value` as `$bindable`. Behavior
   identical.
10. **`handleExternalLink`** keeps the legacy `window.open(url, '_blank', 'noopener,noreferrer')`
    (not the `openMapsUrl`/same-tab mobile heuristic — that is maps-only in the legacy).

## Cross-import debts

None. All imports resolve to already-ported modules: `#features/auth/hooks/auth-context.svelte.ts`,
`#features/auth/hooks/profile-mutations.svelte.ts`, `#features/auth/api/session.server.ts`
(S1), `#features/chat/lib/saved.ts`, `#features/chat/lib/messages.ts`,
`#features/events/api/crud.server.ts`, `#features/events/lib/*` (card 06), `#shared/ui/*`
(S2), `#shared/lib/*`, `#paraglide/messages.js`, and the installed `marked` / `dompurify` /
`lucide-svelte` / `svelte-sonner` deps.

## TODOs

None. No `@migration TODO:` annotations required.
