<script lang="ts">
	import { Dialog } from 'bits-ui'
	import DialogContent from '#shared/ui/dialog/dialog-content.svelte'
</script>

<Dialog.Root open>
	<DialogContent forceMount>
		<Dialog.Title>Fixture dialog</Dialog.Title>
		<Dialog.Description>Fixture description.</Dialog.Description>
	</DialogContent>
</Dialog.Root>
