<script lang="ts">
	import { getLocale, setLocale } from '#paraglide/runtime.js'
	import * as m from '#paraglide/messages.js'
	import { page } from '$app/state'
	import { preserveInstallHintVisit } from '#shared/lib/pwa/install-hint.ts'
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts'
	import { updateLocalePreference } from '#features/auth/api/auth.remote.ts'

	let { class: className = 'w-full px-4 text-muted-foreground hover:bg-muted/50 hover:text-foreground' }: { class?: string } = $props()

	const auth = useAuthContext()
	const otherLocale = getLocale() === 'es' ? 'en' : 'es'

	async function switchLanguage() {
		if (auth.user) {
			try {
				await updateLocalePreference(otherLocale)
			} catch (error) {
				console.error('Failed to save locale preference:', error)
				return
			}
		}
		if (page.url.pathname === '/') preserveInstallHintVisit()
		setLocale(otherLocale)
	}
</script>

<button
	type="button"
	aria-label={m.nav_switch_language()}
	onclick={switchLanguage}
	class={['inline-flex min-h-11 min-w-11 items-center rounded-lg text-sm font-semibold transition-colors', className]}
>
	{otherLocale.toUpperCase()}
</button>
