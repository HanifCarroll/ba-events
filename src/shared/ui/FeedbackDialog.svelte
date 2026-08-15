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

	const SURVEY_ID = '019bc2ff-adb1-0000-362c-eed6326569f2';
	const QUESTION_ID = 'c94107a7-5e8a-4ff3-aa34-f30b41268370';

	// Get the initialized PostHog instance from window
	function getPostHog() {
		if (!browser) return null;
		return (
			window as unknown as {
				posthog?: {
					capture: (event: string, properties?: Record<string, unknown>) => void;
				};
			}
		).posthog;
	}

	let {
		open,
		onOpenChange
	}: { open: boolean; onOpenChange: (open: boolean) => void } = $props();

	let feedback = $state('');
	let isSubmitting = $state(false);
	let submitted = $state(false);

	// Track survey shown event when dialog opens
	$effect(() => {
		if (open && !submitted) {
			getPostHog()?.capture('survey shown', {
				$survey_id: SURVEY_ID
			});
		}
	});

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

	function handleSubmit() {
		if (!feedback.trim() || isSubmitting) return;

		isSubmitting = true;

		try {
			getPostHog()?.capture('survey sent', {
				$survey_id: SURVEY_ID,
				[`$survey_response_${QUESTION_ID}`]: feedback,
				$survey_questions: [
					{
						id: QUESTION_ID,
						question: 'What feedback do you have for us?',
						response: feedback
					}
				]
			});
			submitted = true;
		} catch (error) {
			console.error('Failed to submit feedback:', error);
		} finally {
			isSubmitting = false;
		}
	}

	function handleClose(newOpen: boolean) {
		if (!newOpen && !submitted) {
			// Track dismissal
			getPostHog()?.capture('survey dismissed', {
				$survey_id: SURVEY_ID
			});
		}
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
