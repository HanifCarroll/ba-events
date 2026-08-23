<script lang="ts">
	import { getLocale, setLocale, locales } from '#paraglide/runtime.js';
	import { Globe } from 'lucide-svelte';
	import { Button } from '#shared/ui/button/index.ts';
	import { Tooltip, TooltipContent, TooltipTrigger } from '#shared/ui/tooltip/index.ts';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '#shared/ui/dropdown-menu/index.ts';
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts';
	import { updateLocalePreference } from '#features/auth/api/auth.remote.ts';
	import type { Locale } from '#shared/lib/types.ts';

	const LOCALE_CONFIG: Record<string, { label: string }> = {
		en: { label: 'English' },
		es: { label: 'Español' }
	};

	let { collapsed = false, compact = false }: { collapsed?: boolean; compact?: boolean } = $props();

	const { user } = useAuthContext();
	const currentLocale = getLocale();
	const currentConfig = LOCALE_CONFIG[currentLocale] || LOCALE_CONFIG.en;

	function handleLocaleChange(locale: string) {
		// Save to database if user is logged in (fire and forget)
		if (user) {
			updateLocalePreference(locale as Locale).catch(console.error);
		}
		// Set locale (updates cookie and reloads page)
		setLocale(locale as (typeof locales)[number]);
	}
</script>

{#snippet dropdown()}
	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					class={collapsed
						? 'w-full text-muted-foreground hover:text-foreground hover:bg-muted/50 items-center p-3 justify-center'
						: 'w-full text-muted-foreground hover:text-foreground hover:bg-muted/50 items-center justify-start gap-3 px-4'}
				>
					<Globe class="h-5 w-5 shrink-0" />
					{#if !collapsed}
						<span class="text-sm leading-none">{currentConfig.label}</span>
					{/if}
				</Button>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent side={collapsed ? 'right' : 'top'} align="start" class="w-40">
			{#each locales as locale (locale)}
				{@const config = LOCALE_CONFIG[locale] || { label: locale }}
				{@const isActive = locale === currentLocale}
				<DropdownMenuItem
					onclick={() => handleLocaleChange(locale)}
					class="flex items-center gap-2 cursor-pointer focus:bg-primary/10 focus:text-primary {isActive
						? 'bg-primary/10 text-primary'
						: ''}"
				>
					<span>{config.label}</span>
					{#if isActive}<span class="ml-auto text-primary">✓</span>{/if}
				</DropdownMenuItem>
			{/each}
		</DropdownMenuContent>
	</DropdownMenu>
{/snippet}

{#if compact}
	<div class="flex items-center gap-1" aria-label="Language / Idioma">
		{#each locales as locale (locale)}
			{@const isActive = locale === currentLocale}
			<button
				type="button"
				onclick={() => handleLocaleChange(locale)}
				aria-current={isActive ? 'true' : undefined}
				class="rounded px-1.5 py-1 text-xs font-semibold transition-colors {isActive
					? 'bg-white/15 text-white'
					: 'text-white/65 hover:text-white'}"
			>
				{locale.toUpperCase()}
			</button>
		{/each}
	</div>
{:else if collapsed}
	<Tooltip>
		<TooltipTrigger>
			{#snippet child({ props })}
				<div {...props}>
					{@render dropdown()}
				</div>
			{/snippet}
		</TooltipTrigger>
		<TooltipContent side="right" class="font-medium">
			{currentConfig.label}
		</TooltipContent>
	</Tooltip>
{:else}
	{@render dropdown()}
{/if}
