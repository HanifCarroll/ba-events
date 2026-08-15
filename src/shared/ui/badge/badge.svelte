<script lang="ts">
	import { cn } from "#shared/lib/utils/index.ts";
	import { badgeVariants, type BadgeProps } from "./badge-variants.ts";

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = "default",
		children,
		...restProps
	}: BadgeProps = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
