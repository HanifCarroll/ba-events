<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "#shared/lib/utils/index.ts";
	import type { Snippet } from "svelte";

	type Props = Omit<CommandPrimitive.GroupProps, "child" | "children"> & {
		children?: Snippet;
		heading?: string;
	};

	let {
		ref = $bindable(null),
		class: className,
		children,
		heading,
		value,
		...restProps
	}: Props = $props();
</script>

<CommandPrimitive.Group
	bind:ref
	data-slot="command-group"
	class={cn("text-foreground overflow-hidden p-1", className)}
	value={value ?? heading}
	{...restProps}
>
	{#if heading}
		<CommandPrimitive.GroupHeading class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
			{heading}
		</CommandPrimitive.GroupHeading>
	{/if}
	<CommandPrimitive.GroupItems>
		{@render children?.()}
	</CommandPrimitive.GroupItems>
</CommandPrimitive.Group>
