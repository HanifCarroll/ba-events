<script lang="ts">
	import { Download, Share, X } from 'lucide-svelte'
	import { onMount } from 'svelte'
	import * as m from '#paraglide/messages.js'
	import { Button } from '#shared/ui/button/index.ts'
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '#shared/ui/dialog/index.ts'
	import { installState, promptInstall } from '#shared/lib/pwa/install.svelte.ts'
	import { hideInstallHint, recordInstallHintVisit } from '#shared/lib/pwa/install-hint.ts'

	let { class: className = '', hint = false }: { class?: string; hint?: boolean } = $props()
	let iosDialogOpen = $state(false)
	let returningVisitor = $state(false)
	let available = $derived(
		!installState.installed && (installState.isIos || installState.deferredPrompt !== null)
	)

	onMount(() => {
		if (hint && !installState.installed && window.matchMedia('(width < 48rem) and (pointer: coarse) and (hover: none)').matches) {
			returningVisitor = recordInstallHintVisit()
		}
	})

	function dismissHint() {
		returningVisitor = false
		hideInstallHint()
	}

	async function handleInstall() {
		if (installState.deferredPrompt) {
			await promptInstall()
			if (installState.phase === 'dismissed') dismissHint()
		} else if (installState.isIos) {
			// Safari cannot report a manual install back to this tab.
			dismissHint()
			iosDialogOpen = true
		}
	}
</script>

{#if available}
	{#if hint}
		{#if returningVisitor}
			<div data-section="install-hint" class="install-hint mt-3 items-center gap-1 rounded-xl border border-[#3b3b42] bg-[#19191d] py-1 pr-1 pl-3">
				<p class="flex-1 text-sm leading-snug text-[#eeeeef]">{m.install_hint()}</p>
				<Button variant="ghost" class="min-h-11 min-w-11 px-2 text-[#d0ff36] hover:bg-white/10 hover:text-[#d0ff36]" onclick={handleInstall}>
					{m.install_hint_add()}
				</Button>
				<Button variant="ghost" size="icon" class="size-11 shrink-0 text-[#d5d5db] hover:bg-white/10 hover:text-white" aria-label={m.install_hint_dismiss()} onclick={dismissHint}>
					<X class="size-4" aria-hidden="true" />
				</Button>
			</div>
		{/if}
	{:else}
		<Button variant="ghost" class={className} onclick={handleInstall}>
			<Download class="size-4" aria-hidden="true" />
			<span>{m.install_app()}</span>
		</Button>
	{/if}
{/if}

<Dialog bind:open={iosDialogOpen}>
	<DialogContent class="bg-card border-border/50 max-w-sm">
		<DialogHeader>
			<DialogTitle>{m.install_ios_title()}</DialogTitle>
			<DialogDescription>{m.install_ios_description()}</DialogDescription>
		</DialogHeader>
		<ol class="list-decimal space-y-2 pl-5 text-sm text-foreground">
			<li>
				<span class="inline-flex items-center gap-2">
					{m.install_ios_step_one()}
					<Share class="size-5 text-[#007aff]" aria-hidden="true" />
				</span>
			</li>
			<li>{m.install_ios_view_more()}</li>
			<li>{m.install_ios_step_two()}</li>
		</ol>
		<DialogFooter>
			<Button variant="ghost" onclick={() => (iosDialogOpen = false)}>{m.install_close()}</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<style>
	.install-hint { display: none; }

	@media (width < 48rem) and (pointer: coarse) and (hover: none) {
		.install-hint { display: flex; }
	}
</style>
