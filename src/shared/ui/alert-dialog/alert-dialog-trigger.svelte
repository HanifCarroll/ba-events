<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";

	let { ref = $bindable(null), type = "button", ...restProps }: AlertDialogPrimitive.TriggerProps = $props();
</script>

<AlertDialogPrimitive.Trigger bind:ref data-slot="alert-dialog-trigger" {type} {...restProps} />
