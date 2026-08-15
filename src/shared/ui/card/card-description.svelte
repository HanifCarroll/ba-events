<script lang="ts">
	import { cn } from "#shared/lib/utils/index.ts";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLParagraphElement> & { children?: Snippet } = $props();
</script>

<p data-slot="card-description" class={cn("text-muted-foreground text-sm", className)} {...restProps}>
	{@render children?.()}
</p>
