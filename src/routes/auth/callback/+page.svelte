<script lang="ts">
	import { onMount } from 'svelte';
	import { exchangeCode } from '#features/auth/api/auth.remote.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let clientError = $state<string | null>(null);
	let error = $derived(data.error ?? clientError);
	let status = $state('Completing sign in...');

	onMount(async () => {
		// The `?code=` flow is exchanged in +page.server.ts (which redirects on
		// success). Here we only handle the implicit `#token_hash` flow, whose
		// parameters live in the URL fragment and are never sent to the server.
		if (data.error) return;

		try {
			const hashParams = new URLSearchParams(window.location.hash.substring(1));

			const errorParam = hashParams.get('error');
			const errorDescription = hashParams.get('error_description');

			if (errorParam) {
				clientError = errorDescription || errorParam;
				return;
			}

			const tokenHash = hashParams.get('token_hash');
			const type = hashParams.get('type');

			if (!tokenHash) {
				clientError = 'No authentication token found. The link may have expired.';
				return;
			}

			status = 'Verifying authentication...';

			await exchangeCode({ tokenHash, type: type ?? undefined });

			status = 'Redirecting...';
			// Full navigation so the root layout re-seeds auth state from the
			// session cookies set by the exchange above.
			window.location.href = '/';
		} catch (err) {
			console.error('Auth callback error:', err);
			clientError = err instanceof Error ? err.message : 'Authentication failed';
		}
	});
</script>

{#if error}
	<div class="h-full flex items-center justify-center p-6">
		<div class="text-center">
			<div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10 mb-4">
				<span class="text-destructive text-xl">!</span>
			</div>
			<h2 class="font-display text-lg font-medium mb-2">Authentication Error</h2>
			<p class="text-muted-foreground text-sm mb-4">{error}</p>
			<a href="/login" class="text-primary hover:text-primary/80 text-sm font-medium transition-colors">
				Return to login
			</a>
		</div>
	</div>
{:else}
	<div class="h-full flex items-center justify-center p-6">
		<div class="text-center">
			<div
				class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"
			></div>
			<p class="text-muted-foreground text-sm">{status}</p>
		</div>
	</div>
{/if}
