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

<div data-slot="dialog-footer" class={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...restProps}>
	{@render children?.()}
</div>
