<script lang="ts">
	import { onMount } from 'svelte'
	import * as m from '#paraglide/messages.js'
	import { track } from '#shared/lib/analytics.ts'
	import { createResponseFeedback, type ResponseFeedbackContext, type Helpfulness } from '../lib/response-feedback.ts'

	let { context }: { context: ResponseFeedbackContext } = $props()
	let group: HTMLDivElement
	let rating = $state<Helpfulness | null>(null)
	let feedback: ReturnType<typeof createResponseFeedback> | undefined

	onMount(() => {
		let storage: Storage | undefined
		try { storage = window.sessionStorage } catch { /* Browser storage can be disabled. */ }
		feedback = createResponseFeedback(context, storage, track)
		rating = feedback.state.rating
		// Count offers actually brought into view, rather than every historical reply.
		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) {
				feedback?.show()
				observer.disconnect()
			}
		})
		observer.observe(group)
		return () => observer.disconnect()
	})

	function rate(value: Helpfulness) {
		feedback?.rate(value)
		rating = feedback?.state.rating ?? value
	}
</script>

<div bind:this={group} role="group" aria-label={m.chat_helpfulness_question()}
	class="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
	<span>{m.chat_helpfulness_question()}</span>
	<button type="button" aria-pressed={rating === 'helpful'} onclick={() => rate('helpful')}
		class="min-h-9 rounded-md border border-border px-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/10 aria-pressed:text-primary">
		{m.chat_helpfulness_yes()}
	</button>
	<button type="button" aria-pressed={rating === 'not_helpful'} onclick={() => rate('not_helpful')}
		class="min-h-9 rounded-md border border-border px-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/10 aria-pressed:text-primary">
		{m.chat_helpfulness_no()}
	</button>
	<span role="status">{rating ? m.chat_helpfulness_thanks() : ''}</span>
</div>
