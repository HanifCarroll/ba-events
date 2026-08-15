# Card S2 — ui-primitives

## Objective

Establish the shadcn-svelte primitive set in `src/shared/ui/`, replacing the legacy
React shadcn/ui (Radix) components, per `migration/CONTRACTS.md`.

## Legacy reference

`/Users/hanifcarroll/projects/ba-events/src/shared/ui/` — React versions:
alert-dialog, badge, button, collapsible, dialog, dropdown-menu, form, input, label,
sonner, textarea, tooltip. (`components.json` in the legacy repo root has the style config.)

## Steps

1. Read CONTRACTS.md fully.
2. Init shadcn-svelte NON-interactively. If the CLI prompts, prefer flags; as a fallback
   write `components.json` by hand (aliases: components → `src/shared/ui`, utils/cn →
   `#shared/lib/utils.ts` — the `cn` helper already exists there, ported in wave 1; do not
   let the CLI create a second cn) then run `bunx shadcn-svelte@latest add <list> --yes`.
   If the CLI cannot target `src/shared/ui` cleanly, add to default location then MOVE the
   files and fix their internal imports.
3. Add: `button input label textarea badge dialog alert-dialog dropdown-menu tooltip
   collapsible sonner card command`. Skip `form` (legacy used react-hook-form; new forms
   are plain + form actions).
4. `sonner` → the shadcn-svelte version wraps `svelte-sonner` (already installed).
5. After CLI edits, reconcile: one `cn`, correct `#shared`/`#paraglide` import extensions,
   runes mode, no React leftovers.
6. Port NOTHING from the custom legacy files (`MainLayout`, `ErrorBoundary`,
   `FeedbackDialog`, `PullToRefreshIndicator`, `SkipLink`) — card U3 owns those.
7. Run `bunx @sveltejs/mcp svelte-autofixer` on every `.svelte` file until clean.
8. `bun install` is allowed ONLY as the side effect of the shadcn CLI (it adds bits-ui
   etc.). No other dependency changes. Record every added package in evidence.

## Acceptance

1. All listed primitives exist under `src/shared/ui/` and typecheck:
   `bunx tsc --noEmit 2>&1` — zero errors in `src/shared/ui/**`.
2. `grep -rn "from 'react'\|@radix-ui\|lucide-react" src/shared/ui` → empty
   (`lucide-svelte` is the icon lib).
3. A smoke component renders: create `src/shared/ui/smoke.svelte` using Button + Badge +
   Dialog trigger markup, autofixer-clean, then DELETE it after a successful
   `bunx tsc --noEmit` (note the result in evidence).

## Boundaries

No git, no dev server, no routes, no feature code. Only `src/shared/ui/**`,
`components.json`, and package.json/bun.lock via the CLI.

## Evidence

`migration/evidence/S2-ui-primitives.md` per CONTRACTS.md §10. Must include: the
component → exported-props summary for Button/Input/Dialog/DropdownMenu/Tooltip/Sonner
(UI cards build against this), and the list of CLI-added dependencies.
