# Simplification Plan — Pre-Marketing Cut-Down

> **Status:** Proposed, not yet executed. Hand this to an implementation agent.
> **Date:** 2026-08-08

## Context

BA Events is pre-marketing and pre-traction. A product review concluded the app is
over-built for its stage. The user-facing chat experience is fine; the excess is in
(1) an in-app admin analytics dashboard that duplicates PostHog, (2) a "Planned"
layer on top of "Saved" events, and (3) a user-preferences personalization subsystem
built before demand was validated.

## Goal

Shrink the codebase to the core loop — chat → recommendation → save — so iteration
is cheap during the marketing push. Fewer screens, fewer i18n strings, fewer concepts.

## Hard constraints

- **No database migrations.** Do NOT drop `saved_events.planned_at` or the
  `user_preferences` table. Removing columns/tables is destructive and irreversible
  for existing data; the columns simply become unused. A later migration can drop
  them once the UI removal proves stable.
- **Do not touch the scraper/import pipeline** (`src/features/import/`,
  `src/routes/admin/scraping/`, `src/routes/admin/events/import.tsx`). It feeds the
  events DB and is operator tooling, not user surface.
- **Do not touch** the admin events/venues CRUD, blocklist, or the public
  `/api/events` endpoint.
- Follow AGENTS.md: Bun, direct imports (no barrels), no backwards-compat shims —
  clean cutover, update all callsites, delete dead code.
- Runtime is Bun. Never start the dev server; assume the user has it running.
- After every phase, run `bunx tsc --noEmit` and fix all errors before continuing.

## Phase 1 — Delete the in-app admin analytics dashboard

PostHog's own UI already answers every question this page does. Deleting it removes
a feature slice, a route, four chart components, and a PostHog query layer.

**Delete files/directories:**
- `src/routes/admin/analytics/` — entire directory (`index.tsx`, `index.lazy.tsx`,
  `-components/` with `PageviewsChart.tsx`, `ActiveUsersChart.tsx`,
  `TopEventsTable.tsx`, `SearchTermsTable.tsx`)
- `src/features/analytics/` — entire directory (`hooks/useAnalytics.ts`,
  `api/posthog.ts`, `types.ts`)

**Edit:**
- `src/shared/ui/MainLayout.tsx` — remove the `/admin/analytics` entry from
  `adminNavItems` (~line 118). Remove the `BarChart3` import if now unused.
- `src/routes/admin/index.tsx` — remove the quick link to `/admin/analytics` and
  its `BarChart3` import if unused.
- `src/shared/lib/query.ts` — remove the `DateRange` import from
  `@/features/analytics/types` (line 3) and any analytics-related query keys that
  become dead.
- `messages/en.json` + `messages/es.json` — remove `nav_analytics` and any
  `admin_analytics*` / dashboard-chart keys that are now unreferenced. **Grep each
  key before deleting** — some may be shared.

**Watch out for:**
- `recharts` dependency: grep the codebase for other `recharts` importers. If the
  analytics charts were the only consumer, remove the dependency from
  `package.json` and run `bun install`.
- `src/routeTree.gen.ts` regenerates automatically on the next dev/build run;
  do not hand-edit it.

**Verify:** `bunx tsc --noEmit`, then `bun run build`. Visit `/admin` — no analytics
link; `/admin/analytics` 404s.

## Phase 2 — Remove the preferences / personalization subsystem

Personalization was built before validation and duplicates what users can type into
the chat. Remove it end-to-end: profile form, prompt dialog, server functions,
hooks, and the chat agent's preference wiring.

**Delete files:**
- `src/features/auth/hooks/usePreferences.ts`
- `src/features/auth/api/preferences.ts`
- `src/shared/ui/PersonalizationPrompt.tsx` — first grep for importers; it appears
  unused (no references found outside its own file), but confirm before deleting.

**Edit:**
- `src/routes/profile.tsx` — delete the entire `PreferencesForm` component and its
  render site. Remove now-unused imports: `usePreferences`, `useUpdatePreferences`,
  `CATEGORIES`, `Category`, `Neighborhood`, `Textarea`, the category icon imports
  (`Sparkles, Music, Palette, Utensils, Users, Dumbbell, PartyPopper, MapPin` — keep
  only what the remaining display-name/delete-account UI uses), `POPULAR_NEIGHBORHOODS`,
  `CATEGORY_ICONS`, `getCategoryLabel`. The page keeps: display name form, account
  info, delete account dialog.
- `src/shared/lib/query.ts` — remove the `preferences` block from `queryKeys`
  (~lines 59-64).
- `src/shared/lib/types.ts` — remove `UserPreferences` and `UserPreferencesUpdate`
  interfaces (~line 552 area). Keep unrelated types.
- Chat agent preference wiring:
  - `src/features/chat/api/tools/get-user-context.ts` — remove the
    `getUserPreferences` helper, the `preferences` field from the returned context,
    and preference mentions in the tool description. Keep saved-events counts and
    auth status.
  - `src/features/chat/api/tools/search-events.ts` — remove the
    `getUserPreferencesForSearch` helper and the block that applies preferred
    categories/neighborhoods as default filters (~lines 216-240). Explicit user
    filters must be unaffected.
  - `src/features/chat/api/prompts/concierge-v1.ts` — remove the preferences
    section of the system prompt (~lines 199-243) and the "personalization" bullet
    in the changelog header. Add a new changelog line noting personalization was
    removed.
  - `src/features/chat/api/prompts/concierge-v2.ts` — remove the
    `## Personalization` section (~lines 58-60).
- `messages/en.json` + `messages/es.json` — remove preference-specific keys:
  `profile_about_placeholder`, `profile_about_help`, `profile_event_interests`,
  `profile_preferred_neighborhoods`, `profile_save_preferences`,
  `profile_save_failed`, plus any `personalization_*` prompt keys. **Grep before
  deleting:** `profile_saved` ("Saved") is also used by the display-name form —
  keep it if still referenced.

**Do NOT** drop the `user_preferences` table. It becomes unused; that's fine.

**Verify:** `bunx tsc --noEmit`, `bun run build`. `/profile` shows only display
name + account + delete. Chat still answers vague queries ("what's good tonight?")
sensibly — spot-check one conversation.

## Phase 3 — Merge "Planned" into "Saved" (remove the plan concept)

Today there are two concepts: saving an event (`saved_events` row) and "confirming
a plan" (`planned_at` timestamp + `YourPlanCard`). Collapse to one: **Saved**. The
"Make it happen" CTA in chat and on the event page becomes a plain save action.

### 3a. Saved-events data layer

`src/features/chat/lib/saved.ts`:
- Delete `confirmPlan` entirely.
- Delete `getSavedEventState`; switch its remaining caller
  (`src/routes/-components/SaveEventButton.tsx`, line 48) to the existing
  `isEventSaved` helper.
- Remove `planned_at` from the `getSavedEvents` select and from the
  `SavedEventWithDetails` mapping (~lines 27-28, 47-48).
- Update `src/features/chat/index.ts` exports (remove `confirmPlan`,
  `getSavedEventState`).

`src/shared/lib/types.ts`:
- Remove `ConfirmedPlanData`, the `plan?` fields on message/attached-data types
  (~lines 464, 792), `planned_at` from `SavedEventWithDetails` (~line 549). Check
  the interface near line 721-731 (`decisionMade` / `selectedEvent`) — if it only
  exists to feed `YourPlanCard`, remove it too.
- Keep `planned_at` on the raw DB row type if one exists, since the column stays.

### 3b. Delete YourPlanCard and the plan UI flow

- Delete `src/routes/-components/chat/YourPlanCard.tsx`.
- `src/routes/-components/chat/ChatMessage.tsx` — remove `YourPlanCard` render
  block (~lines 79-84), the `onConfirmPlan` / `isConfirmingPlan` props, and the
  pass-through to event lists (~lines 91-97).
- `src/routes/-components/chat/MessageList.tsx` — remove `onConfirmPlan` /
  `planningAssistantMessageId` props and pass-throughs.
- `src/routes/-components/chat/ChatContainer.tsx` — delete `handleConfirmPlan`
  (~lines 592-645), the `planningAssistantMessageId` state and its reset in the
  new-chat handler, the `confirmPlan` import, and the props passed to `MessageList`
  (~lines 860-861).
- `src/routes/-components/events/EventCard.tsx` — remove `onConfirmPlan` /
  `isConfirmingPlan` props and the "Make it happen" button (~lines 174-181). **In
  its place, render the existing `SaveEventButton`** so the hero card still has a
  primary save action. Do the same in `EventList.tsx` prop plumbing (remove the
  confirm props).
- `src/routes/event/$id.tsx` — remove `plan` / `isPlanning` state,
  `handleConfirmPlan`, the confirm button (~lines 219-223), the `YourPlanCard`
  render (~lines 278-283), the `getSavedEventState` effect (replace with
  `isEventSaved` if the page still needs saved state — it already renders
  `SaveEventButton`, so likely nothing is needed), and the `ConfirmedPlanData`
  import.
- `src/routes/saved.tsx` — remove the planned/saved split: delete
  `plannedUpcoming`, `savedUpcoming`, `plannedPast`, `savedPast` memos and the
  `YourPlanCard` section. Result: one list with the existing upcoming/past filter.
- `src/routes/-components/chat/ChatContainer.test.ts` — update/remove plan-related
  assertions.

### 3c. Analytics event types

`src/lib/analytics.ts` — remove `concierge:add_to_calendar` and
`concierge:share_plan` from `ConciergeEvent` (they were only fired from
`YourPlanCard`). Keep `concierge:get_directions` if `DirectionsCard` still uses it —
grep to confirm.

### 3d. i18n

Remove plan-only keys from `messages/en.json` + `messages/es.json`:
`concierge_your_plan`, `concierge_make_it_happen`, `concierge_saving_plan`,
`concierge_share_plan`, `concierge_confirmed`, plus any `saved_*` keys tied to the
planned sections. **Grep every key first** — `concierge_add_calendar` /
`concierge_get_directions` may still be referenced by surviving UI.

**Verify:** `bunx tsc --noEmit`, `bun run build`, `bun test`. Manual smoke: chat
recommendation card has a save button that saves; `/saved` lists it under
Upcoming; `/event/$id` saves via the same button; no "plan" UI anywhere
(`grep -ri "plan" src/routes src/features/chat` should only hit unrelated matches
like `planning` in unrelated contexts — review each hit).

## Phase 4 — Record the decision

Per AGENTS.md, add a new entry to `docs/decisions.md`:

- **Date:** 2026-08-08
- **What:** Removed in-app admin analytics (use PostHog directly), removed the
  preferences/personalization subsystem, merged "Planned" into "Saved".
- **Alternatives considered:** keeping personalization behind a flag; migrating the
  DB to drop `planned_at` / `user_preferences` (rejected — destructive, no benefit
  pre-traction).
- **Rationale:** pre-marketing stage; shrink maintenance surface (screens, i18n
  strings, agent prompt complexity) so iteration stays cheap. Reinstate any piece
  only when usage data justifies it.

Also add a convention note: admin ops UI (scraping, blocklist, venue review) is
**frozen** — operate via SQL/scripts, no new admin screens without explicit
approval.

## Out of scope (explicitly)

- No marketing/distribution work (that is the human's next job, not code).
- No changes to auth, i18n locales, event detail page SEO/JSON-LD, or the public
  API.
- No database migrations of any kind.
- No new features.

## Final acceptance

1. `bunx tsc --noEmit` clean, `bun run build` clean, `bun test` clean.
2. Sidebar shows: New chat, Saved, Settings, Feedback; admin section shows:
   Dashboard, Events, Venues, Blocklist, Scraping (no Analytics).
3. `/profile` = display name + account + delete account only.
4. One save concept everywhere; no "plan"/"Make it happen" UI.
5. No dangling i18n keys (grep a sample of removed keys → zero references) and no
   unused imports left behind.
