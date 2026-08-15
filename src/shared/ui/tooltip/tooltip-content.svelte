<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import { cn } from "#shared/lib/utils/index.ts";
	import TooltipPortal from "./tooltip-portal.svelte";
	import type { Snippet } from "svelte";

	type Props = Omit<TooltipPrimitive.ContentProps, "child" | "children"> & {
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 0,
		children,
		...restProps
	}: Props = $props();
</script>

<TooltipPortal>
	<TooltipPrimitive.Content
		bind:ref
		data-slot="tooltip-content"
		{sideOffset}
		class={cn(
			"bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		<TooltipPrimitive.Arrow class="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
	</TooltipPrimitive.Content>
</TooltipPortal>
