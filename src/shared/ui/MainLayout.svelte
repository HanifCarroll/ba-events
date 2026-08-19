<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		Menu,
		X,
		MessageSquarePlus,
		Bookmark,
		Settings,
		LogOut,
		User,
		ChevronLeft,
		ChevronRight,
		MessageCircle
	} from 'lucide-svelte';
	import { Button } from '#shared/ui/button/index.ts';
	import { Tooltip, TooltipContent, TooltipTrigger } from '#shared/ui/tooltip/index.ts';
	import SkipLink from '#shared/ui/SkipLink.svelte';
	import { useAuthContext, getAuthState } from '#features/auth/hooks/auth-context.svelte.ts';
	import { signOut } from '#features/auth/api/auth.remote.ts';
	import LanguageSwitcher from '#shared/ui/LanguageSwitcher.svelte';
	import FeedbackDialog from '#shared/ui/FeedbackDialog.svelte';
	import * as m from '#paraglide/messages.js';

	interface NavItem {
		to?: string;
		label: string;
		icon: typeof MessageSquarePlus;
		action?: () => void;
		requiresAuth?: boolean;
		adminOnly?: boolean;
		exact?: boolean;
	}

	let { children }: { children: import('svelte').Snippet } = $props();

	const auth = useAuthContext();
	let mobileMenuOpen = $state(false);
	let isSigningOut = $state(false);
	let collapsed = $state(false);
	let collapsedPreferenceLoaded = $state(false);
	let feedbackOpen = $state(false);

	// Resolve browser-only preferences after hydration so the server and first
	// client render always agree.
	onMount(() => {
		collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
		collapsedPreferenceLoaded = true;
	});

	// Persist collapsed state after the stored preference has been read.
	$effect(() => {
		if (collapsedPreferenceLoaded) {
			localStorage.setItem('sidebar-collapsed', String(collapsed));
		}
	});

	function handleFeedback() {
		feedbackOpen = true;
		mobileMenuOpen = false;
	}

	async function handleSignOut() {
		isSigningOut = true;
		try {
			await signOut();
			// Clear the shared auth state so the sidebar updates immediately.
			const state = getAuthState();
			state.user = null;
			state.profile = null;
			await goto('/');
		} catch (err) {
			console.error('Sign out error:', err);
		} finally {
			isSigningOut = false;
		}
	}

	function isActive(to: string, exact?: boolean) {
		if (exact || to === '/') {
			return page.url.pathname === to;
		}
		return page.url.pathname.startsWith(to);
	}

	const mainNavItems: NavItem[] = [
		{ to: '/', label: m.nav_new_chat(), icon: MessageSquarePlus, exact: true },
		{ to: '/saved', label: m.nav_saved(), icon: Bookmark, requiresAuth: true },
		{ to: '/profile', label: m.nav_settings(), icon: Settings, requiresAuth: true },
		{ label: 'Feedback', icon: MessageCircle, action: handleFeedback }
	];

	const filteredMainNavItems = $derived(
		mainNavItems.filter((item) => {
			if (item.requiresAuth && !auth.user) return false;
			return true;
		})
	);
</script>

{#snippet navItem(item: NavItem, showLabel: boolean)}
	{@const active = item.to ? isActive(item.to, item.exact) : false}
	{#if item.action && !item.to}
		<button onclick={item.action} class="w-full text-left">
			<div
				class="group flex items-center gap-3 rounded-lg transition-colors duration-200 cursor-pointer min-h-11 {showLabel
					? 'px-3.5 py-2.5'
					: 'p-3 justify-center'} {active
					? 'bg-primary/[0.07] text-primary'
					: 'text-foreground/75 hover:text-foreground hover:bg-muted'}"
			>
				<item.icon class="h-5 w-5 shrink-0 {active ? 'text-primary' : ''}" />
				{#if showLabel}<span class="font-medium truncate">{item.label}</span>{/if}
			</div>
		</button>
	{:else}
		<a
			href={item.to ?? ''}
			onclick={() => {
				item.action?.();
				mobileMenuOpen = false;
			}}
		>
			<div
				class="group flex items-center gap-3 rounded-lg transition-colors duration-200 cursor-pointer min-h-11 {showLabel
					? 'px-3.5 py-2.5'
					: 'p-3 justify-center'} {active
					? 'bg-primary/[0.07] text-primary'
					: 'text-foreground/75 hover:text-foreground hover:bg-muted'}"
			>
				<item.icon class="h-5 w-5 shrink-0 {active ? 'text-primary' : ''}" />
				{#if showLabel}<span class="font-medium truncate">{item.label}</span>{/if}
			</div>
		</a>
	{/if}
{/snippet}

<div class="relative h-full flex flex-col lg:flex-row overflow-hidden">
	<SkipLink />

	<!-- Mobile header -->
	<header
		class="lg:hidden h-16 border-b bg-card flex items-center gap-3 px-4 shrink-0 z-30"
	>
		<Button
			variant="ghost"
			size="icon"
			onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
			aria-expanded={mobileMenuOpen}
			class="size-11 text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0"
		>
			{#if mobileMenuOpen}<X class="h-5 w-5" />{:else}<Menu class="h-5 w-5" />{/if}
		</Button>
		<a href="/" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
			<span class="text-base font-semibold tracking-tight">BA Eventos</span>
		</a>
	</header>

	<!-- Mobile menu — slides down OVER the content (does not push it) -->
	<div
		class="lg:hidden absolute inset-x-0 top-16 z-40 grid transition-[grid-template-rows] duration-300 ease-in-out {mobileMenuOpen
			? 'grid-rows-[1fr]'
			: 'grid-rows-[0fr]'}"
	>
		<div class="overflow-hidden shadow-lg shadow-black/10">
			<nav class="border-b bg-card px-4 py-3 flex flex-col gap-1" aria-label="Mobile menu">
				{#each filteredMainNavItems as item (item.label)}
					{@render navItem(item, true)}
				{/each}
				<div class="my-2 h-px bg-border"></div>
				<LanguageSwitcher />
				{#if auth.user}
					<div class="space-y-2">
						<div class="px-3 py-2">
							<p class="text-xs text-muted-foreground uppercase tracking-wider">
								{m.auth_signed_in_as()}
							</p>
							<p class="text-sm text-foreground truncate">
								{auth.profile?.display_name || auth.user.email?.split('@')[0]}
							</p>
						</div>
						<Button
							variant="ghost"
							onclick={handleSignOut}
							disabled={isSigningOut}
							class="w-full justify-start gap-3 px-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
						>
							<LogOut class="h-5 w-5" />
							<span>{isSigningOut ? m.auth_signing_out() : m.auth_sign_out()}</span>
						</Button>
					</div>
				{:else}
					<Button
						variant="ghost"
						href="/login"
						onclick={() => (mobileMenuOpen = false)}
						class="w-full justify-start gap-3 px-3 text-foreground hover:bg-muted hover:text-foreground"
					>
						<User class="h-5 w-5" />
						<span>{m.auth_sign_in()}</span>
					</Button>
				{/if}
			</nav>
		</div>
	</div>

	<!-- Mobile menu backdrop — dims content, closes on tap -->
	{#if mobileMenuOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="lg:hidden fixed inset-0 z-20 bg-black/40"
			onclick={() => (mobileMenuOpen = false)}
		></div>
	{/if}

	<!-- Sidebar (desktop only) -->
	<aside
		class={collapsed
			? 'hidden lg:flex flex-col shrink-0 h-full border-r bg-card lg:w-[72px]'
			: 'hidden lg:flex flex-col shrink-0 h-full border-r bg-card lg:w-[238px]'}
	>
		<!-- Sidebar header -->
		<div class="h-20 flex items-center justify-between px-5 shrink-0">
			<a
				href="/"
				class="flex items-center gap-3 hover:opacity-80 transition-opacity overflow-hidden {collapsed
					? 'lg:justify-center lg:w-full'
					: ''}"
			>
				<div
					class="overflow-hidden transition-all duration-300 {collapsed
						? 'lg:w-0 lg:opacity-0'
						: 'w-auto opacity-100'}"
				>
					<span
						class="text-base font-semibold tracking-tight text-foreground whitespace-nowrap"
					>
						BA Eventos
					</span>
				</div>
			</a>
			<button
				onclick={() => (collapsed = !collapsed)}
				class="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-200 {collapsed
					? 'absolute right-2'
					: ''}"
				aria-label={collapsed ? m.sidebar_expand() : m.sidebar_collapse()}
			>
				{#if collapsed}<ChevronRight class="h-4 w-4" />{:else}<ChevronLeft class="h-4 w-4" />{/if}
			</button>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 px-5 py-4 overflow-y-auto flex flex-col">
			<!-- Main navigation -->
			<div class="flex flex-col gap-1">
				{#each filteredMainNavItems as item (item.label)}
					{@const showLabel = !collapsed || mobileMenuOpen}
					{#if collapsed && !mobileMenuOpen}
						<Tooltip>
							<TooltipTrigger>
								{#snippet child({ props })}
									<div {...props}>
										{@render navItem(item, false)}
									</div>
								{/snippet}
							</TooltipTrigger>
							<TooltipContent side="right" class="font-medium">{item.label}</TooltipContent>
						</Tooltip>
					{:else}
						{@render navItem(item, showLabel)}
					{/if}
				{/each}
			</div>

			<!-- Conversation history (signed-in) -->
			<!-- @migration TODO: render ConversationHistory here once U1 ports it.
			     Legacy: <ConversationHistory collapsed={collapsed && !mobileMenuOpen} /> -->

			<!-- Spacer -->
			<div class="flex-1"></div>
		</nav>

		<!-- Language switcher -->
		<div class="px-5 pb-3">
			<LanguageSwitcher collapsed={collapsed && !mobileMenuOpen} />
		</div>

		<div
			class="h-px bg-border {collapsed && !mobileMenuOpen ? 'mx-3' : 'mx-5'}"
		></div>

		<!-- User section -->
		<div class="p-5 pt-3">
			{#if auth.user}
				<div class="space-y-2">
					<!-- User info - only show when expanded -->
					<div
						class="overflow-hidden transition-all duration-300 {collapsed && !mobileMenuOpen
							? 'h-0 opacity-0'
							: 'h-auto opacity-100 px-3 py-2'}"
					>
						<p class="text-xs text-muted-foreground uppercase tracking-wider">
							{m.auth_signed_in_as()}
						</p>
						<p class="text-sm text-foreground truncate">
							{auth.profile?.display_name || auth.user.email?.split('@')[0]}
						</p>
					</div>
					<!-- Sign out button -->
					{#if collapsed && !mobileMenuOpen}
						<Tooltip>
							<TooltipTrigger>
								{#snippet child({ props })}
									<Button
										{...props}
										onclick={(e) => {
											(props.onclick as ((evt: MouseEvent) => void) | undefined)?.(e);
											handleSignOut();
										}}
										variant="ghost"
										disabled={isSigningOut}
										class="w-full p-3 justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
									>
										<LogOut class="h-5 w-5" />
									</Button>
								{/snippet}
							</TooltipTrigger>
							<TooltipContent side="right" class="font-medium">
								{isSigningOut ? m.auth_signing_out() : m.auth_sign_out()}
							</TooltipContent>
						</Tooltip>
					{:else}
						<Button
							variant="ghost"
							onclick={handleSignOut}
							disabled={isSigningOut}
							class="w-full justify-start gap-3 px-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
						>
							<LogOut class="h-5 w-5" />
							<span
								class="transition-all duration-300 {collapsed && !mobileMenuOpen
									? 'w-0 opacity-0'
									: 'w-auto opacity-100'}"
							>
								{isSigningOut ? m.auth_signing_out() : m.auth_sign_out()}
							</span>
						</Button>
					{/if}
				</div>
			{:else}
				<!-- Sign in button -->
				{#if collapsed && !mobileMenuOpen}
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									href="/login"
									class="w-full p-3 justify-center text-foreground hover:bg-muted hover:text-foreground"
								>
									<User class="h-5 w-5" />
								</Button>
							{/snippet}
						</TooltipTrigger>
						<TooltipContent side="right" class="font-medium">
							{m.auth_sign_in()}
						</TooltipContent>
					</Tooltip>
				{:else}
					<Button
						variant="ghost"
						href="/login"
						onclick={() => (mobileMenuOpen = false)}
						class="w-full justify-start gap-3 px-3 text-foreground hover:bg-muted hover:text-foreground"
					>
						<User class="h-5 w-5" />
						<span>{m.auth_sign_in()}</span>
					</Button>
				{/if}
			{/if}
		</div>
	</aside>

	<!-- Main content -->
	<main id="main-content" class="flex-1 min-h-0 relative flex flex-col">
		<div class="relative flex-1 min-h-0">
			{@render children()}
		</div>
	</main>

	<!-- Feedback Dialog -->
	<FeedbackDialog open={feedbackOpen} onOpenChange={(o) => (feedbackOpen = o)} />
</div>
