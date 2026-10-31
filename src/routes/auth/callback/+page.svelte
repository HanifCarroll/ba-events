<script lang="ts">
	import { useMachine } from '@xstate/svelte';
	import { createAuthCallbackMachine } from '#features/auth/hooks/sign-in.machine.ts';
	import { onMount } from 'svelte';
	import { exchangeCode } from '#features/auth/api/auth.remote.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const { snapshot, send } = useMachine(createAuthCallbackMachine({
		exchange: exchangeCode,
		redirect: () => { window.location.href = '/'; }
	}));
	const error = $derived(data.error ?? $snapshot.context.error);
	const status = $derived($snapshot.matches('redirecting') ? 'Redirecting...' : $snapshot.matches('verifying') ? 'Verifying authentication...' : 'Completing sign in...');

	onMount(() => {
		if (data.error) return;
		const params = new URLSearchParams(window.location.hash.substring(1));
		const linkError = params.get('error');
		if (linkError) {
			send({ type: 'FAIL', error: params.get('error_description') || linkError });
			return;
		}
		const tokenHash = params.get('token_hash');
		if (!tokenHash) {
			send({ type: 'FAIL', error: 'No authentication token found. The link may have expired.' });
			return;
		}
		send({ type: 'VERIFY', tokenHash, tokenType: params.get('type') ?? undefined });
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
