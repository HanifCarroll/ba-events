<script lang="ts">
	import { Mail, Sparkles, Check } from 'lucide-svelte';
	import { signInWithGoogle, signInWithMagicLink } from '#features/auth/api/client.ts';
	import { Button } from '#shared/ui/button/index.ts';
	import { Input } from '#shared/ui/input/index.ts';
	import { Label } from '#shared/ui/label/index.ts';
	import * as m from '#paraglide/messages.js';

	let email = $state('');
	let error = $state<string | null>(null);
	let isSubmitting = $state(false);
	let isGoogleSubmitting = $state(false);
	let magicLinkSent = $state(false);

	async function handleGoogleSignIn() {
		error = null;
		isGoogleSubmitting = true;

		try {
			await signInWithGoogle();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to sign in with Google';
			isGoogleSubmitting = false;
		}
	}

	async function handleMagicLink(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		isSubmitting = true;

		try {
			await signInWithMagicLink(email);
			magicLinkSent = true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to send magic link';
		} finally {
			isSubmitting = false;
		}
	}
</script>

<div class="h-full flex items-center justify-center p-6 overflow-auto">
	<!-- Decorative background elements -->
	<div class="fixed inset-0 overflow-hidden pointer-events-none">
		<div class="absolute top-1/4 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl"></div>
		<div class="absolute bottom-1/4 -right-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl"></div>
		<div
			class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-[0.02]"
		>
			<svg viewBox="0 0 100 100" class="w-full h-full">
				<circle
					cx="50"
					cy="50"
					r="45"
					fill="none"
					stroke="currentColor"
					stroke-width="0.5"
					class="text-primary"
				></circle>
				<circle
					cx="50"
					cy="50"
					r="35"
					fill="none"
					stroke="currentColor"
					stroke-width="0.3"
					class="text-primary"
				></circle>
				<circle
					cx="50"
					cy="50"
					r="25"
					fill="none"
					stroke="currentColor"
					stroke-width="0.2"
					class="text-primary"
				></circle>
			</svg>
		</div>
	</div>

	<div class="relative w-full max-w-md animate-fade-in-up">
		<!-- Header -->
		<div class="text-center mb-8">
			<div class="inline-flex items-center gap-2 mb-4">
				<div class="w-1 h-8 bg-gradient-to-b from-primary to-accent rounded-full"></div>
				<h1 class="font-display text-3xl font-semibold tracking-tight">
					{m.login_welcome()}
				</h1>
			</div>
			<p class="text-muted-foreground text-sm">
				{m.login_subtitle()}
			</p>
		</div>

		<div class="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-xl shadow-black/20">
			<Button
				type="button"
				onclick={handleGoogleSignIn}
				disabled={isGoogleSubmitting || isSubmitting}
				variant="outline"
				class="w-full bg-background/50"
			>
				{#if isGoogleSubmitting}
					<div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
				{:else}
					<span aria-hidden="true" class="font-semibold">G</span>
					{m.login_google_submit()}
				{/if}
			</Button>

			<div class="flex items-center gap-3 my-5 text-xs text-muted-foreground" aria-hidden="true">
				<div class="h-px flex-1 bg-border/50"></div>
				<span>{m.login_or()}</span>
				<div class="h-px flex-1 bg-border/50"></div>
			</div>

			<form onsubmit={handleMagicLink} class="space-y-4">
				{#if magicLinkSent}
					<div class="text-center py-4">
						<div
							class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4"
						>
							<Check class="h-6 w-6 text-primary" />
						</div>
						<h3 class="font-display text-lg font-medium mb-2">{m.login_check_email()}</h3>
						<p class="text-muted-foreground text-sm">
							{m.login_magic_sent({ email })}
						</p>
						<button
							type="button"
							onclick={() => (magicLinkSent = false)}
							class="mt-4 text-sm text-primary hover:text-primary/80 transition-colors"
						>
							{m.login_send_another()}
						</button>
					</div>
				{:else}
					<div class="space-y-2">
						<Label for="magic-email" class="text-sm text-muted-foreground">
							{m.login_email()}
						</Label>
						<div class="relative">
							<Mail
								class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
							/>
							<Input
								id="magic-email"
								type="email"
								value={email}
								oninput={(e) => (email = e.currentTarget.value)}
								placeholder="you@example.com"
								class="pl-10 bg-background/50 border-border/50 focus:border-primary/50"
								required
							/>
						</div>
					</div>

					<p class="text-xs text-muted-foreground">
						{m.login_magic_description()} New accounts are created automatically when your
						email is allowed by Supabase.
					</p>

					{#if error}
						<div
							class="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
						>
							{error}
						</div>
					{/if}

					<Button
						type="submit"
						disabled={isSubmitting}
						class="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
					>
						{#if isSubmitting}
							<div
								class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
							></div>
						{:else}
							{m.login_magic_submit()}
							<Sparkles class="ml-2 h-4 w-4" />
						{/if}
					</Button>
				{/if}
			</form>
		</div>

		<div class="mt-6 text-center text-xs text-muted-foreground">
			Use the same email whether you are returning or signing in for the first time.
		</div>

		<!-- Decorative bottom element -->
		<div class="flex items-center justify-center gap-2 mt-8">
			<div class="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
			<div class="w-1.5 h-1.5 rounded-full bg-primary/30"></div>
			<div class="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
		</div>
	</div>
</div>
