import { command, getRequestEvent } from '$app/server'
import type { Locale } from '#shared/lib/types.ts'
import * as server from '#features/auth/api/server.server.ts'

// Remote wrappers for the auth server functions (CONTRACTS.md §5).
// `getSessionUser` is intentionally NOT wrapped — the root layout's load data
// covers it (see src/routes/+layout.server.ts).

export const signOut = command(async () => server.signOut(getRequestEvent()))

export const exchangeCode = command('unchecked', async (data: { code?: string; tokenHash?: string; type?: string }) =>
	server.exchangeCode(getRequestEvent(), data)
)

export const updateLocalePreference = command('unchecked', async (locale: Locale) =>
	server.updateLocalePreference(getRequestEvent(), locale)
)

export const deleteAccount = command('unchecked', async (data: { userId: string }) =>
	server.deleteAccount(getRequestEvent(), data)
)
