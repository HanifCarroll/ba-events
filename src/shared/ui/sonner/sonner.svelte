<script lang="ts">
	import { Toaster as Sonner, type ToasterProps } from "svelte-sonner";
	import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-svelte";

	let { ...restProps }: ToasterProps = $props();
</script>

<Sonner
	theme="dark"
	class="toaster group"
	style="--normal-bg: var(--popover); --normal-text: var(--popover-foreground); --normal-border: var(--border); --border-radius: var(--radius);"
	{...restProps}
>
	{#snippet successIcon()}
		<CircleCheck class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<Info class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlert class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonX class="size-4" />
	{/snippet}
	{#snippet loadingIcon()}
		<LoaderCircle class="size-4 animate-spin" />
	{/snippet}
</Sonner>
