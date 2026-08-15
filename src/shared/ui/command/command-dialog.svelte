<script lang="ts">
	import * as Dialog from "#shared/ui/dialog/index.ts";
	import { cn } from "#shared/lib/utils/index.ts";
	import Command from "./command.svelte";
	import type { Snippet } from "svelte";
	import type { Dialog as DialogPrimitive } from "bits-ui";

	type Props = Omit<DialogPrimitive.RootProps, "child" | "children"> & {
		value?: string;
		children?: Snippet;
		title?: string;
		description?: string;
		showCloseButton?: boolean;
		class?: string;
	};

	let {
		open = $bindable(false),
		value = $bindable(""),
		class: className,
		title = "Command Palette",
		description = "Search for a command to run...",
		showCloseButton = false,
		children,
		...restProps
	}: Props = $props();
</script>

<Dialog.Dialog bind:open {...restProps}>
	<Dialog.DialogHeader class="sr-only">
		<Dialog.DialogTitle>{title}</Dialog.DialogTitle>
		<Dialog.DialogDescription>{description}</Dialog.DialogDescription>
	</Dialog.DialogHeader>
	<Dialog.DialogContent class={cn("overflow-hidden p-0", className)} {showCloseButton}>
		<Command bind:value {children} />
	</Dialog.DialogContent>
</Dialog.Dialog>
