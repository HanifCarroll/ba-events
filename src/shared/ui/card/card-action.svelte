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

<div data-slot="card-action" class={cn("ml-auto", className)} {...restProps}>
	{@render children?.()}
</div>
