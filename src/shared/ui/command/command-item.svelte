<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "#shared/lib/utils/index.ts";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: CommandPrimitive.ItemProps = $props();
</script>

<CommandPrimitive.Item
	bind:ref
	data-slot="command-item"
	class={cn(
		"relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-disabled:pointer-events-none data-selected:bg-accent data-selected:text-accent-foreground data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
		className
	)}
	{...restProps}
/>
