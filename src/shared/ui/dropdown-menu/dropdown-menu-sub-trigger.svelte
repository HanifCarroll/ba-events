<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { ChevronRight } from "lucide-svelte";
	import { cn } from "#shared/lib/utils/index.ts";
	import type { Snippet } from "svelte";

	type Props = Omit<DropdownMenuPrimitive.SubTriggerProps, "child" | "children"> & {
		inset?: boolean;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: Props = $props();
</script>

<DropdownMenuPrimitive.SubTrigger
	bind:ref
	data-slot="dropdown-menu-sub-trigger"
	data-inset={inset}
	class={cn(
		"focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ChevronRight class="ml-auto size-4" />
</DropdownMenuPrimitive.SubTrigger>
