<script lang="ts">
	import { CheckCircle } from 'lucide-svelte';
	import { browser } from '$app/env';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '#shared/ui/dialog/index.ts';
	import { Button } from '#shared/ui/button/index.ts';
	import { Textarea } from '#shared/ui/textarea/index.ts';
	import { track } from '#shared/lib/analytics.ts';

	let {
		open,
		onOpenChange
	}: { open: boolean; onOpenChange: (open: boolean) => void } = $props();

	let feedback = $state('');
	let isSubmitting = $state(false);
	let submitted = $state(false);

	// Auto-close after submission
	$effect(() => {
		if (submitted) {
			const timer = setTimeout(() => {
				onOpenChange(false);
				// Reset state after close animation
				setTimeout(() => {
					submitted = false;
					feedback = '';
				}, 200);
			}, 2000);
			return () => clearTimeout(timer);
		}
	});

	async function handleSubmit() {
		if (!feedback.trim() || isSubmitting) return;

		isSubmitting = true;

		try {
			const response = await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message: feedback })
			});
			if (!response.ok) throw new Error('Feedback submission failed');
			track('feedback:submitted');
			submitted = true;
		} catch (error) {
			console.error('Failed to submit feedback:', error);
		} finally {
			isSubmitting = false;
		}
	}

	function handleClose(newOpen: boolean) {
		onOpenChange(newOpen);

		// Reset state after close animation
		if (!newOpen) {
			setTimeout(() => {
				submitted = false;
				feedback = '';
			}, 200);
		}
	}
</script>

<Dialog {open} onOpenChange={handleClose}>
	<DialogContent class="bg-card border-border/50 max-w-md">
		{#if submitted}
			<!-- Thank you state -->
			<div class="py-8 text-center">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"
				>
					<CheckCircle class="h-6 w-6 text-primary" />
				</div>
				<DialogTitle class="font-display text-foreground mb-2">Thank you!</DialogTitle>
				<DialogDescription class="text-muted-foreground">
					Your feedback helps us improve BA Eventos.
				</DialogDescription>
			</div>
		{:else}
			<!-- Feedback form -->
			<DialogHeader>
				<DialogTitle class="font-display text-foreground">
					What feedback do you have for us?
				</DialogTitle>
				<DialogDescription class="text-muted-foreground">
					Tell us what you like, what could be better, or report any issues.
				</DialogDescription>
			</DialogHeader>

			<Textarea
				class="min-h-[120px] bg-background/50 border-border/50 focus-visible:border-primary/50 focus-visible:ring-primary/20"
				placeholder="Start typing..."
				value={feedback}
				oninput={(e) => (feedback = e.currentTarget.value)}
				autofocus
			/>

			<DialogFooter>
				<Button variant="ghost" onclick={() => handleClose(false)}>Cancel</Button>
				<Button
					onclick={handleSubmit}
					disabled={!feedback.trim() || isSubmitting}
					class="bg-primary hover:bg-primary/90"
				>
					{isSubmitting ? 'Sending...' : 'Send Feedback'}
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
