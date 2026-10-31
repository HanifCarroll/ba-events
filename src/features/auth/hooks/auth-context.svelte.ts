import { createContext } from 'svelte'
import { browser } from '$app/env'
import { createActor } from 'xstate'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '#shared/lib/types.ts'
import { getSupabaseBrowserClient, fetchProfile } from '#features/auth/api/client.ts'
import { createAuthMachine, type AuthSeed } from './auth.machine.ts'

export interface AuthContextValue {
	user: User | null
	profile: Profile | null
	isAdmin: boolean
	loading: boolean
}

const authMachine = createAuthMachine(fetchProfile)

/** One browser session owns its profile request; SSR gets a request-local instance. */
export class AuthState implements AuthContextValue {
	private actor
	private snapshot

	constructor(initial: AuthSeed = {}) {
		this.actor = createActor(authMachine, { input: initial })
		this.snapshot = $state.raw(this.actor.getSnapshot())
		this.actor.subscribe((snapshot) => { this.snapshot = snapshot })
		this.actor.start()
	}

	get user() { return this.snapshot.context.user }
	set user(user: User | null) { this.actor.send({ type: 'SESSION_CHANGED', user }) }
	get profile() { return this.snapshot.context.profile }
	set profile(profile: Profile | null) {
		if (this.user) this.updateProfile(this.user.id, profile)
	}
	get revision() { return this.snapshot.context.revision }
	get loading() { return this.snapshot.matches('loadingProfile') }
	get isAdmin() { return this.profile?.role === 'admin' }
	seed(value: AuthSeed) { this.actor.send({ type: 'SEED', value }) }
	updateProfile(userId: string, profile: Profile | null, revision = this.revision) {
		this.actor.send({ type: 'PROFILE_UPDATED', userId, profile, revision })
	}
}

let browserAuthState: AuthState | undefined
const [get, set] = createContext<AuthContextValue>()

export function initAuthContext(initial?: AuthSeed | null): AuthContextValue {
	if (!browser) {
		const state = new AuthState(initial ?? {})
		set(state)
		return state
	}
	if (!browserAuthState) {
		browserAuthState = new AuthState(initial ?? {})
		const state = browserAuthState
		getSupabaseBrowserClient().auth.onAuthStateChange((_event, session) => {
			state.user = session?.user ?? null
		})
	} else {
		browserAuthState.seed(initial ?? {})
	}
	set(browserAuthState)
	return browserAuthState
}

export function useAuthContext(): AuthContextValue { return get() }

/** Browser mutation helpers share the actor; server render callers use context. */
export function getAuthState(): AuthState {
	if (!browser) return get() as AuthState
	return browserAuthState ??= new AuthState()
}
