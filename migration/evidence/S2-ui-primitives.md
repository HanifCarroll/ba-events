# S2 — ui-primitives — evidence

## Scope done

Established the shadcn-svelte primitive set in `src/shared/ui/` (13 components), replacing the
legacy React shadcn/ui (Radix) set, per CONTRACTS.md and card S2.

`components.json` — hand-written shadcn-svelte config (aliases → `#shared/ui`, utils → `#shared/lib/utils/index`).

`src/shared/ui/button/`
- `button-variants.ts` — `buttonVariants` (cva, legacy new-york class strings verbatim), `ButtonVariant`/`ButtonSize`/`ButtonProps` types.
- `button.svelte` — `Button` (renders `<a>` when `href`, else `<button>`; replaces legacy `asChild`).
- `index.ts` — re-exports `Button`, `buttonVariants`, types.

`src/shared/ui/badge/` — `badge-variants.ts` + `badge.svelte` (`Badge`, `<a>`/`<span>` via `href`) + `index.ts`.

`src/shared/ui/input/`, `label/`, `textarea/` — `Input` (plain `<input>`), `Label` (bits-ui Label), `Textarea` (plain `<textarea>`); legacy class strings verbatim.

`src/shared/ui/card/` — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` (no legacy source; classic shadcn new-york card).

`src/shared/ui/dialog/` — `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogOverlay`, `DialogContent` (with internal close button), `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`.

`src/shared/ui/alert-dialog/` — `AlertDialog` + Trigger/Portal/Overlay/Content/Header/Footer/Title/Description/Action/Cancel (Action/Cancel reuse `buttonVariants`).

`src/shared/ui/dropdown-menu/` — `DropdownMenu` + Trigger/Portal/Content/Group/Label/Item/CheckboxItem/RadioGroup/RadioItem/Separator/Shortcut/Sub/SubTrigger/SubContent.

`src/shared/ui/tooltip/` — `Tooltip` (wraps Provider), `TooltipProvider`, `TooltipTrigger`, `TooltipContent` (with Arrow), `TooltipPortal`.

`src/shared/ui/collapsible/` — `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` (CLI-generated; faithful — legacy had no classes).

`src/shared/ui/sonner/` — `Toaster` wrapping `svelte-sonner` (legacy `theme="dark"`, icon set, CSS vars).

`src/shared/ui/command/` — `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut` (no legacy source; standard shadcn command on bits-ui Command).

`src/shared/ui/smoke.svelte` — created for the smoke check (Button + Badge + Dialog), autofixer-clean,
`tsc --noEmit` clean, then deleted.

## Commands + outputs

### `bunx tsc --noEmit 2>&1` (acceptance #1)
```
(no output)
(exit 0)
```

### `bun run check` (svelte-check, extra gate)
```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
1786812003017 START "/Users/hanifcarroll/projects/ba-events-sveltekit"
1786812003034 COMPLETED 5743 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

### `bunx @sveltejs/mcp svelte-autofixer` (every `.svelte`, §9 gate)
All 66 `.svelte` files under `src/shared/ui/` return `issues: []`. (One transient fix
applied: `<textarea />` → `<textarea></textarea>`; `bind:this` "use an action/attachment"
suggestions are non-blocking and the shadcn-svelte convention keeps `bind:this`/`bind:ref`.)

### `grep -rn "from 'react'\|@radix-ui\|lucide-react" src/shared/ui` (acceptance #2)
```
(no output; exit 1 = empty)
```

### Smoke component (acceptance #3)
`src/shared/ui/smoke.svelte` used `Button` + `Badge` + `Dialog.Dialog`/`DialogTrigger`/
`DialogContent` markup. Autofixer result: `issues: [], suggestions: [], require_another_tool_call_after_fixing: false`.
`bunx tsc --noEmit` exit 0. File deleted afterwards (confirmed absent).

## Component → exported-props summary (UI cards build against this)

### Button — `#shared/ui/button/index.ts`
`Button` (also `Root`); props: `variant` = `"default" | "destructive" | "outline" | "secondary" | "ghost" | "link"` (default `"default"`), `size` = `"default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg"` (default `"default"`), `href` (renders `<a>`), `type` (default `"button"`), `disabled`, `class`, all `HTMLButtonAttributes`/`HTMLAnchorAttributes`, `children` snippet. Also exports `buttonVariants` (cva), `ButtonProps`, `ButtonSize`, `ButtonVariant`.

### Input — `#shared/ui/input/index.ts`
`Input`; props: all `HTMLInputAttributes` (`type`, `value`, `placeholder`, `class`, …). Plain `<input>`.

### Dialog — `#shared/ui/dialog/index.ts`
`Dialog` (Root; `open` bindable), `DialogTrigger` (`type` default `"button"`, supports `child` snippet for `asChild`), `DialogPortal`, `DialogOverlay`, `DialogContent` (`showCloseButton` default `true`, `class`, `children` snippet), `DialogHeader`, `DialogFooter` (plain divs), `DialogTitle`, `DialogDescription`, `DialogClose`.

### DropdownMenu — `#shared/ui/dropdown-menu/index.ts`
`DropdownMenu` (Root; `open` bindable), `DropdownMenuTrigger` (`child` snippet for `asChild`), `DropdownMenuPortal`, `DropdownMenuContent` (`sideOffset` default `4`), `DropdownMenuGroup`, `DropdownMenuLabel` (`inset`), `DropdownMenuItem` (`inset`, `variant` `"default" | "destructive"`), `DropdownMenuCheckboxItem` (`checked` bindable), `DropdownMenuRadioGroup` (`value` bindable), `DropdownMenuRadioItem` (`value`), `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger` (`inset`, appends chevron), `DropdownMenuSubContent`.

### Tooltip — `#shared/ui/tooltip/index.ts`
`Tooltip` (Root; wraps `TooltipProvider`), `TooltipProvider` (`delayDuration` default `0`), `TooltipTrigger` (`child` snippet for `asChild`), `TooltipContent` (`sideOffset` default `0`, `side` default top, `children` snippet, internal Arrow), `TooltipPortal`.

### Sonner — `#shared/ui/sonner/index.ts`
`Toaster`; props: all `svelte-sonner` `ToasterProps` (`position`, `duration`, `closeButton`, `richColors`, …) plus fixed `theme="dark"`, custom `successIcon`/`infoIcon`/`warningIcon`/`errorIcon`/`loadingIcon` snippets (lucide-svelte), and CSS vars `--normal-bg`/`--normal-text`/`--normal-border`/`--border-radius`.

## CLI-added dependencies

`bunx shadcn-svelte@latest add collapsible --yes` (used to install the bits-ui runtime, the
sanctioned dependency mechanism) added to **devDependencies**:

- `bits-ui@^2.16.3` → resolved `2.18.1`
- `@internationalized/date@^3.12.0` → resolved `3.12.3` (bits-ui peer dependency)

bits-ui transitive deps (in `bun.lock` only): `@floating-ui/core`, `@floating-ui/dom`,
`esm-env`, `runed`, `svelte-toolbelt`, `tabbable`. No other package.json changes were made.

## Deviations

1. **`cn` import path.** Card step 2 says utils → `#shared/lib/utils.ts`, but the wave-1 `cn`
   helper actually lives at `#shared/lib/utils/index.ts` (verified `#shared/lib/utils.ts` does
   not resolve). All components import `#shared/lib/utils/index.ts`. No second `cn` created.
2. **CLI used only for the dependency install, then hand-ported.** The current shadcn-svelte
   registry (v1.5.0, "vega"/"nova" styles) no longer serves the legacy "new-york" style and
   diverges heavily (IconPlaceholder component, `@lucide/svelte`, `tailwind-variants`, `.js`
   import extensions, `data-open`/`data-closed` attributes, different class strings). I ran
   `add collapsible` to install `bits-ui`, then hand-ported every component against the legacy
   React new-york sources (exact class strings), using already-installed `class-variance-authority`
   and `lucide-svelte` (instead of adding `tailwind-variants` / `@lucide/svelte`).
3. **`data-state` kept verbatim.** bits-ui 2.18.1 sets `data-state="open"/"closed"` (same as
   Radix), so the legacy `data-[state=open]:…` / `data-[state=closed]:…` classes were kept
   unchanged (the registry's `data-open:`/`data-closed:` would not match bits-ui).
4. **Radix-only CSS vars removed.** `max-h-(--radix-dropdown-menu-content-available-height)`
   and `origin-(--radix-*-content-transform-origin)` are Radix internals that bits-ui does not
   set (floating-ui drives positioning). Dropped as no-ops.
5. **Tooltip `data-slot` omitted.** bits-ui's `Tooltip.Provider`/`Tooltip.Root` prop types are
   `WithoutHTML` and reject `data-slot`; removed from those two files only (deviation from legacy `data-slot`).
6. **`asChild` → Svelte idioms.** Radix `Slot`/`asChild` becomes bits-ui `child` snippets on
   triggers and `href` on `Button`/`Badge` (the shadcn-svelte translation).
7. **Icon names.** `lucide-react` → `lucide-svelte` PascalCase without the `Icon` suffix:
   `XIcon→X`, `CheckIcon→Check`, `CircleIcon→Circle`, `ChevronRightIcon→ChevronRight`,
   `CircleCheckIcon→CircleCheck`, `InfoIcon→Info`, `TriangleAlertIcon→TriangleAlert`,
   `OctagonXIcon→OctagonX`, `Loader2Icon→LoaderCircle`.
8. **`bits-ui` in devDependencies.** The CLI placed it there (registry `devDependencies` field);
   left as-is per "no other dependency changes" — fine for SvelteKit (bundled at build time).
9. **Sonner `theme="dark"` kept.** Legacy hardcoded `theme="dark"` despite the app being
   light-mode (`color-scheme: light`). Kept the behavior; flagged as a legacy quirk.
10. **card / command have no legacy source** — implemented as standard shadcn components
    (boring faithful choice), command built on bits-ui `Command` (no `input-group`/`separator`
    extras; search icon inlined).
11. **`class-variance-authority`** (already installed) used for button/badge variants instead
    of the CLI's `tailwind-variants` (not added).

## Cross-import debts

None. `src/shared/ui/**` depends only on: `#shared/lib/utils/index.ts` (exists, wave 1),
`bits-ui`, `lucide-svelte`, `class-variance-authority`, `svelte-sonner` (all installed).

## TODOs

None (`@migration TODO` list empty).
