<script lang="ts">
	import { cn } from "#shared/lib/utils/index.ts";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	type Props = HTMLAttributes<HTMLDivElement> & {
		inset?: boolean;
		children?: Snippet;
	};

	let {
		class: className,
		inset,
		children,
		...restProps
	}: Props = $props();
</script>

<div data-slot="dropdown-menu-label" data-inset={inset} class={cn("px-2 py-1.5 text-sm font-medium data-[inset]:pl-8", className)} {...restProps}>
	{@render children?.()}
</div>
