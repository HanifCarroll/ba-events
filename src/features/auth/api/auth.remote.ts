import { command, getRequestEvent } from '$app/server'
import { Effect, Schema } from 'effect'
import type { Locale } from '#shared/lib/types.ts'
import * as server from '#features/auth/api/server.server.ts'

// Remote wrappers for the auth server functions (CONTRACTS.md §5).
// `getSessionUser` is intentionally NOT wrapped — the root layout's load data
// covers it (see src/routes/+layout.server.ts).

export const signOut = command(async () => Effect.runPromise(server.signOutEffect(getRequestEvent())))

const exchangeCodeInput = Schema.toStandardSchemaV1(Schema.Struct({
	code: Schema.optional(Schema.String),
	tokenHash: Schema.optional(Schema.String),
	type: Schema.optional(Schema.String),
}))
const localeInput = Schema.toStandardSchemaV1(Schema.Literals(['en', 'es']))
const deleteAccountInput = Schema.toStandardSchemaV1(Schema.Struct({ userId: Schema.String }))

export const exchangeCode = command(exchangeCodeInput, async (data: { code?: string; tokenHash?: string; type?: string }) =>
	Effect.runPromise(server.exchangeCodeEffect(getRequestEvent(), data))
)

export const updateLocalePreference = command(localeInput, async (locale: Locale) =>
	Effect.runPromise(server.updateLocalePreferenceEffect(getRequestEvent(), locale))
)

export const deleteAccount = command(deleteAccountInput, async (data: { userId: string }) =>
	Effect.runPromise(server.deleteAccountEffect(getRequestEvent(), data))
)
