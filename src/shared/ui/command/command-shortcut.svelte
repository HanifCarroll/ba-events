<script lang="ts">
	import { cn } from "#shared/lib/utils/index.ts";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLSpanElement> & { children?: Snippet } = $props();
</script>

<span data-slot="command-shortcut" class={cn("text-muted-foreground ml-auto text-xs tracking-widest", className)} {...restProps}>
	{@render children?.()}
</span>
