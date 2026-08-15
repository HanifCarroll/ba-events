<script lang="ts">
	import { cn } from "#shared/lib/utils/index.ts";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<div data-slot="card-title" class={cn("font-semibold leading-none tracking-tight", className)} {...restProps}>
	{@render children?.()}
</div>
