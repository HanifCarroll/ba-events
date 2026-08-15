<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import TooltipProvider from "./tooltip-provider.svelte";

	let { ...restProps }: TooltipPrimitive.RootProps = $props();
</script>

<TooltipProvider>
	<TooltipPrimitive.Root {...restProps} />
</TooltipProvider>
