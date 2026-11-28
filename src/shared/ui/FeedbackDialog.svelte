<script lang="ts">
	import { CheckCircle } from 'lucide-svelte';
	import { useMachine } from '@xstate/svelte';
	import { createFeedbackMachine } from './feedback.machine.ts';
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
	import * as m from '#paraglide/messages.js';

	let {
		open,
		onOpenChange
	}: { open: boolean; onOpenChange: (open: boolean) => void } = $props();

	const { snapshot, send } = useMachine(createFeedbackMachine({
		submit: async (message, signal) => {
			const response = await fetch('/api/feedback', {
				method: 'POST', signal,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message })
			});
			if (!response.ok) throw new Error('Feedback submission failed');
		},
		close: () => onOpenChange(false),
		submitted: () => track('feedback:submitted')
	}));
	const feedback = $derived($snapshot.context.message);
	const isSubmitting = $derived($snapshot.matches('submitting'));
	const submitted = $derived($snapshot.matches('submitted'));
	$effect(() => { send({ type: open ? 'OPEN' : 'CLOSE' }); });
	function handleSubmit() { send({ type: 'SUBMIT' }); }
	function handleClose(newOpen: boolean) {
		send({ type: newOpen ? 'OPEN' : 'CLOSE' });
		onOpenChange(newOpen);
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
				<DialogTitle class="font-display text-foreground mb-2">{m.feedback_thanks()}</DialogTitle>
				<DialogDescription class="text-muted-foreground">
					{m.feedback_thanks_description()}
				</DialogDescription>
			</div>
		{:else}
			<!-- Feedback form -->
			<DialogHeader>
				<DialogTitle class="font-display text-foreground">
					{m.feedback_prompt()}
				</DialogTitle>
				<DialogDescription class="text-muted-foreground">
					{m.feedback_description()}
				</DialogDescription>
			</DialogHeader>

			<Textarea
				class="min-h-[120px] bg-background/50 border-border/50 focus-visible:border-primary/50 focus-visible:ring-primary/20"
				placeholder={m.feedback_placeholder()}
				value={feedback}
				oninput={(e) => send({ type: 'EDIT', message: e.currentTarget.value })}
				disabled={isSubmitting}
				autofocus
			/>

			{#if $snapshot.context.error}<p role="alert" class="text-sm text-destructive">{m.feedback_error()}</p>{/if}

			<DialogFooter>
				<Button variant="ghost" onclick={() => handleClose(false)}>{m.feedback_cancel()}</Button>
				<Button
					onclick={handleSubmit}
					disabled={!feedback.trim() || isSubmitting}
					class="bg-primary hover:bg-primary/90"
				>
					{isSubmitting ? m.feedback_sending() : m.feedback_send()}
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
