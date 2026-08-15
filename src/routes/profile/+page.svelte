<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { User, Mail, Trash2, ArrowLeft, AlertTriangle, Loader2, Check } from 'lucide-svelte';
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts';
	import {
		updateDisplayName,
		deleteAccount
	} from '#features/auth/hooks/profile-mutations.svelte.ts';
	import { displayNameSchema } from '#shared/lib/schemas.ts';
	import { Button } from '#shared/ui/button/index.ts';
	import { Input } from '#shared/ui/input/index.ts';
	import { Label } from '#shared/ui/label/index.ts';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle,
		AlertDialogTrigger
	} from '#shared/ui/alert-dialog/index.ts';
	import * as m from '#paraglide/messages.js';

	const auth = useAuthContext();

	// Delete account state (kept separate since it's in a dialog)
	let deleteConfirmText = $state('');
	let deletePending = $state(false);
	let deleteError = $state<string | null>(null);

	const defaultDisplayName = $derived(auth.profile?.display_name || '');

	// Display name form state
	let displayName = $state(untrack(() => defaultDisplayName));
	let displayNamePending = $state(false);
	let displayNameError = $state<string | null>(null);
	let showDisplayNameSuccess = $state(false);

	// Sync form when profile loads
	onMount(() => {
		if (defaultDisplayName) {
			displayName = defaultDisplayName;
		}
	});

	const isDisplayNameDirty = $derived(displayName !== defaultDisplayName);

	const onSubmitDisplayName = async (event: SubmitEvent) => {
		event.preventDefault();

		const result = displayNameSchema.safeParse({ displayName });
		if (!result.success) {
			displayNameError = result.error.issues[0]?.message ?? 'Invalid display name';
			return;
		}

		displayNameError = null;
		displayNamePending = true;

		try {
			await updateDisplayName(result.data.displayName);
			showDisplayNameSuccess = true;
			setTimeout(() => {
				showDisplayNameSuccess = false;
			}, 3000);
		} catch (error) {
			displayNameError =
				error instanceof Error ? error.message : 'Failed to update display name';
		} finally {
			displayNamePending = false;
		}
	};

	const handleDelete = async () => {
		const userId = auth.user?.id;
		if (!userId) return;
		if (deleteConfirmText !== 'DELETE') return;

		deletePending = true;
		deleteError = null;

		try {
			await deleteAccount(userId);
			void goto('/');
		} catch (error) {
			deleteError = error instanceof Error ? error.message : 'Failed to delete account';
			deletePending = false;
		}
	};

	const handleDisplayNameInput = (event: Event) => {
		displayName = (event.currentTarget as HTMLInputElement).value;
	};

	const handleDeleteConfirmInput = (event: Event) => {
		deleteConfirmText = (event.currentTarget as HTMLInputElement).value;
	};
</script>

{#if !auth.user}
	<!-- Guard against edge case where context hasn't synced yet -->
	<div class="h-full flex items-center justify-center">
		<div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
	</div>
{:else}
	<div class="h-full flex flex-col overflow-auto">
		<!-- Decorative background elements -->
		<div class="fixed inset-0 overflow-hidden pointer-events-none">
			<div class="absolute top-1/3 -right-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl"></div>
			<div class="absolute bottom-1/3 -left-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl"></div>
			<!-- Art deco corner accent -->
			<div class="absolute bottom-10 right-10 w-24 h-24 opacity-[0.03]">
				<svg viewBox="0 0 100 100" class="w-full h-full">
					<path
						d="M0 100 L0 60 L40 60 L40 0 L100 0 L100 100 Z"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						class="text-primary"
					/>
					<path
						d="M20 100 L20 80 L60 80 L60 20 L100 20"
						fill="none"
						stroke="currentColor"
						stroke-width="1"
						class="text-primary"
					/>
				</svg>
			</div>
		</div>

		<!-- Content -->
		<div class="relative flex-1 px-6 py-6">
			<div class="max-w-2xl mx-auto">
				<a
					href="/"
					class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
				>
					<ArrowLeft class="h-4 w-4" />
					{m.profile_back()}
				</a>

				<!-- Header -->
				<div class="mb-8">
					<div class="flex items-center gap-3 mb-2">
						<div class="p-2 rounded-lg bg-primary/10 border border-primary/20">
							<User class="h-5 w-5 text-primary" />
						</div>
						<h1 class="font-display text-2xl font-semibold tracking-tight">
							Profile
						</h1>
					</div>
					<p class="text-muted-foreground text-sm">
						Manage your profile and account preferences
					</p>
				</div>

				<div class="space-y-6">
					<!-- Profile Section -->
					<section
						class="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6"
					>
						<h2 class="font-display text-lg font-medium mb-4 flex items-center gap-2">
							<User class="h-4 w-4 text-primary/60" />
							Account
						</h2>

						<!-- Email (read-only) -->
						<div class="mb-6">
							<Label class="text-sm text-muted-foreground">Email</Label>
							<div
								class="mt-1.5 flex items-center gap-3 px-3 py-2.5 rounded-lg bg-background/50 border border-border/50"
							>
								<Mail class="h-4 w-4 text-muted-foreground" />
								<span class="text-sm">{auth.user.email}</span>
							</div>
						</div>

						<!-- Display Name Form -->
						<form onsubmit={onSubmitDisplayName} class="space-y-2">
							<Label for="displayName" class="text-sm text-muted-foreground">
								Display Name
							</Label>
							<div class="flex gap-2">
								<Input
									id="displayName"
									value={displayName}
									oninput={handleDisplayNameInput}
									placeholder="Enter your display name"
									class="bg-background/50 border-border/50 focus:border-primary/50"
								/>
								<Button
									type="submit"
									disabled={displayNamePending || !isDisplayNameDirty}
									class="shrink-0"
								>
									{#if displayNamePending}
										<Loader2 class="h-4 w-4 animate-spin" />
									{:else if showDisplayNameSuccess}
										<Check class="h-4 w-4" />
									{:else}
										Save
									{/if}
								</Button>
							</div>
							{#if displayNameError}
								<p class="text-sm text-destructive">{displayNameError}</p>
							{/if}
							{#if showDisplayNameSuccess}
								<p class="text-sm text-primary">Display name updated!</p>
							{/if}
						</form>
					</section>

					<!-- Danger Zone -->
					<section class="bg-destructive/5 border border-destructive/20 rounded-xl p-6">
						<h2
							class="font-display text-lg font-medium mb-2 flex items-center gap-2 text-destructive"
						>
							<AlertTriangle class="h-4 w-4" />
							Danger Zone
						</h2>
						<p class="text-sm text-muted-foreground mb-4">
							Permanently delete your account and all associated data. This action
							cannot be undone.
						</p>

						<AlertDialog>
							<AlertDialogTrigger>
								{#snippet child({ props })}
									<Button {...props} variant="destructive" class="gap-2">
										<Trash2 class="h-4 w-4" />
										Delete Account
									</Button>
								{/snippet}
							</AlertDialogTrigger>
							<AlertDialogContent class="bg-card border-border">
								<AlertDialogHeader>
									<AlertDialogTitle class="flex items-center gap-2">
										<AlertTriangle class="h-5 w-5 text-destructive" />
										Delete Account
									</AlertDialogTitle>
									<AlertDialogDescription class="text-muted-foreground">
										This will permanently delete your account, including all your
										saved events. This action cannot be undone.
									</AlertDialogDescription>
								</AlertDialogHeader>

								<div class="py-4">
									<Label
										for="deleteConfirm"
										class="text-sm text-muted-foreground"
									>
										Type
										<span class="font-mono font-bold text-foreground">DELETE</span>
										to confirm
									</Label>
									<Input
										id="deleteConfirm"
										value={deleteConfirmText}
										oninput={handleDeleteConfirmInput}
										placeholder="DELETE"
										class="mt-2 bg-background/50 border-border/50"
									/>
									{#if deleteError}
										<p class="mt-2 text-sm text-destructive">{deleteError}</p>
									{/if}
								</div>

								<AlertDialogFooter>
									<AlertDialogCancel
										onclick={() => {
											deleteConfirmText = '';
										}}
									>
										Cancel
									</AlertDialogCancel>
									<AlertDialogAction
										onclick={handleDelete}
										disabled={deleteConfirmText !== 'DELETE' || deletePending}
										class="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
									>
										{#if deletePending}
											<Loader2 class="h-4 w-4 animate-spin" />
										{:else}
											Delete Account
										{/if}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</section>
				</div>

				<!-- Decorative bottom element -->
				<div class="flex items-center justify-center gap-2 mt-10 mb-6">
					<div
						class="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent"
					></div>
					<div class="w-1.5 h-1.5 rounded-full bg-primary/30"></div>
					<div
						class="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent"
					></div>
				</div>
			</div>
		</div>
	</div>
{/if}
