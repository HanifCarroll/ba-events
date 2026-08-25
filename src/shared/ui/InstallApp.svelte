<script lang="ts">
	import { Download, Share } from 'lucide-svelte'
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

	let {
		class: className = '',
		compact = false
	}: { class?: string; compact?: boolean } = $props()
	let iosDialogOpen = $state(false)
	let available = $derived(
		!installState.installed && (installState.isIos || installState.deferredPrompt !== null)
	)

	function handleInstall() {
		if (installState.isIos) iosDialogOpen = true
		else void promptInstall()
	}
</script>

{#if available}
	<Button
		variant="ghost"
		class={className}
		onclick={handleInstall}
		aria-label={m.install_app()}
	>
		<Download class="size-4" aria-hidden="true" />
		<span class={compact ? 'hidden sm:inline' : ''}>{m.install_app()}</span>
	</Button>
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
