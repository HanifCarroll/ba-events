<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import { Search } from "lucide-svelte";
	import { cn } from "#shared/lib/utils/index.ts";

	let {
		ref = $bindable(null),
		value = $bindable(""),
		class: className,
		...restProps
	}: CommandPrimitive.InputProps = $props();
</script>

<div data-slot="command-input-wrapper" class="flex items-center border-b px-3">
	<Search class="mr-2 size-4 shrink-0 opacity-50" />
	<CommandPrimitive.Input
		bind:ref
		bind:value
		data-slot="command-input"
		class={cn(
			"placeholder:text-muted-foreground flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50",
			className
		)}
		{...restProps}
	/>
</div>
