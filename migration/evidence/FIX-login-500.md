# FIX — login 500 missing_context — evidence

## Scope done

- `src/features/auth/hooks/auth-context.svelte.ts` — fixed `initAuthContext` so it
  (a) re-seeds `authState` from `initial` on **every** render and (b) always calls
  `set(authState)` before `get()`. The `initialized` flag now only guards the
  client-side `onAuthStateChange` subscription.

Root cause: `initialized` is module-level and persists across SSR requests in the
long-running preview process. On the first render it ran `set(authState)`; on every
later render it skipped `set()` and fell straight through to `return get()`. Svelte
contexts are established per render, so `get()` threw
`https://svelte.dev/e/missing_context` on the second and all subsequent requests.
(Note: this affected every route after the first request, not only `EXCLUDED_ROUTES`;
the `/login` repro was simply the page the reporter hit.)

## Commands + outputs

### `bunx @sveltejs/mcp svelte-autofixer src/features/auth/hooks/auth-context.svelte.ts`

```
Detected file path, reading file...
{
  issues: [],
  suggestions: [],
  require_another_tool_call_after_fixing: false
}
```

### `bunx tsc --noEmit`

```
tsc exit: 0
```
(no output — zero errors)

### `bun run build`

```
...
✓ built in 2.81s
...
✔ done
```

### Acceptance curls (against restarted preview on 127.0.0.1:4173)

```
req1  login:200  register:303  callback:200  root:200
req2  login:200  register:303  callback:200  root:200
req3  login:200  register:303  callback:200  root:200
req4  login:200  register:303  callback:200  root:200
req5  login:200  register:303  callback:200  root:200
```

Header checks:

```
=== register Location header ===
HTTP/1.1 303 See Other
location: /login

=== login Location (no session) ===
HTTP/1.1 200 OK
```

Rendered body spot checks (no error page):

```
/login         → "Magic-link sign in only"
/auth/callback → "Completing sign in"
```

## Deviations

- `/register` returns **303 → /login**, not 200. This is the intended legacy
  behavior (`register/+page.server.ts` always `throw redirect(303, '/login' +
  url.search)`), preserved by this card — the acceptance's "→ 200" is read as
  "not 500". It is a redirect, not the `missing_context` 500.
- The already-running `vite preview` on 4173 had the pre-fix build loaded into
  memory (the SSR handler is imported once at startup), so it could not reflect the
  source fix. I ran `bun run build` and restarted the preview with the exact same
  command (`bun run preview -- --host 127.0.0.1 --port 4173`) to serve the new build,
  then curled it. Same server, same port — not a new/duplicate server.
- `initAuthContext` now re-seeds `authState` from `initial` on every call instead of
  only the first. This is a deliberate correction (not a redesign): the module-level
  singleton is shared across SSR requests, so gating seeding on `initialized` would
  have leaked one request's session into the next render. The legacy React provider
  re-initialised per request, so re-seeding restores that behavior. Client behavior is
  unchanged (`initAuthContext` still runs once per mount; the subscription stays
  guarded by `initialized`).

## Cross-import debts

None. This card touched no modules owned by another card, and `tsc --noEmit` is clean.

## TODOs

None.
