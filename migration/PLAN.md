# Migration Plan — TanStack Start → SvelteKit 3

Coordinator: Kimi K3. Workers: DeepSeek v4 Pro via `pi`. Evidence-gated per card.

- Legacy (read-only): `/Users/hanifcarroll/projects/ba-events`
- Target: `/Users/hanifcarroll/projects/ba-events-sveltekit`
- Binding rules: `migration/CONTRACTS.md`. Worker context: `AGENTS.md` (auto-loaded by pi).

## Waves

| Wave | Cards | Runs |
|---|---|---|
| 0 Foundation | scaffold, env, i18n, theme, deps, contracts | DONE (coordinator) |
| 1 Shared core | 01 shared-db, 02 shared-ai-utils | parallel |
| 2 Feature cores | 03 import-scrapers, 04 import-core, 05 chat-api, 06 chat-lib+events | parallel |
| 3 Shell | S1 auth-hooks-locals, S2 ui-primitives | parallel |
| 4 Routes/UI | U1 chat-ui, U2 events-ui, U3 auth-pages, U4 routes, A1 api-endpoints | parallel |
| 5 Backend jobs | T1 trigger + evals + scripts + netlify | single |
| 6 Verify | check + test + build + smoke | coordinator |

## Status

| Card | State | Evidence |
|---|---|---|
| 01 shared-db | done | migration/evidence/01-shared-db.md |
| 02 shared-ai-utils | done | migration/evidence/02-shared-ai-utils.md |
| 03 import-scrapers | done | migration/evidence/03-import-scrapers.md |
| 04 import-core | done | migration/evidence/04-import-core.md |
| 05 chat-api | done | migration/evidence/05-chat-api.md |
| 06 chat-lib-events | done | migration/evidence/06-chat-lib-events.md |
| S1 auth-shell | done | migration/evidence/S1-auth-shell.md |
| S2 ui-primitives | done | migration/evidence/S2-ui-primitives.md |
| FIX saved.ts | done | migration/evidence/FIX-saved-ts.md |
| U1 chat-ui | done | migration/evidence/U1-chat-ui.md |
| U2 events-ui | done | migration/evidence/U2-events-ui.md |
| U3 auth-pages | done | migration/evidence/U3-auth-pages.md |
| U4 routes-layout | done | migration/evidence/U4-routes-layout.md |
| A1 api-endpoints | done | migration/evidence/A1-api-endpoints.md |
| T1 trigger-evals-deploy | done | migration/evidence/T1-trigger-evals-deploy.md |
| FIX login-500 | done | migration/evidence/FIX-login-500.md |

## Cutover (after all waves)

Point deployment + dev habits at this repo; archive legacy. Requires Hanif sign-off.
