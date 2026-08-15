<script lang="ts">
	import { AlertCircle, RotateCcw } from 'lucide-svelte';
	import { Button } from '#shared/ui/button/index.ts';
	import { dev } from '$app/env';
	import type { Snippet } from 'svelte';

	let { children, fallback }: { children: Snippet; fallback?: Snippet } = $props();

	function handleReset(): void {
		// Reload the page to reset the app state
		window.location.reload();
	}

	function onerror(error: unknown): void {
		console.error('ErrorBoundary caught an error:', error);
	}
</script>

<svelte:boundary {onerror}>
	{@render children()}

	{#snippet failed(error)}
		{#if fallback}
			{@render fallback()}
		{:else}
			<div class="min-h-screen flex items-center justify-center bg-background p-4">
				<div class="max-w-md w-full text-center space-y-6">
					<div class="flex justify-center">
						<div class="rounded-full bg-destructive/10 p-4">
							<AlertCircle class="h-12 w-12 text-destructive" />
						</div>
					</div>

					<div class="space-y-2">
						<h1 class="text-2xl font-semibold text-foreground">Something went wrong</h1>
						<p class="text-muted-foreground">
							An unexpected error occurred. Please try again.
						</p>
					</div>

					{#if dev && error instanceof Error}
						<div class="bg-card/50 rounded-lg border border-border/50 p-4 text-left">
							<p class="text-sm font-mono text-destructive break-all">
								{error.message}
							</p>
						</div>
					{/if}

					<Button
						onclick={handleReset}
						class="bg-primary text-primary-foreground hover:bg-primary/90"
					>
						<RotateCcw class="h-4 w-4 mr-2" />
						Try Again
					</Button>
				</div>
			</div>
		{/if}
	{/snippet}
</svelte:boundary>
