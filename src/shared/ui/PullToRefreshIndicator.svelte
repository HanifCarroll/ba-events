<script lang="ts">
	import { RefreshCw } from 'lucide-svelte';
</script>

<!--
	Visual indicator for the pull-to-refresh gesture.
	Controlled via direct DOM manipulation by the `pullToRefresh` attachment for
	60fps performance (see src/shared/hooks/pull-to-refresh.svelte.ts).

	The attachment manipulates:
	- height and opacity on this container (found via [data-pull-indicator])
	- transform rotation on [data-pull-icon]
	- the animate-spin class during refresh
-->
<div
	data-pull-indicator
	class="flex items-center justify-center overflow-hidden"
	style="height: 0; opacity: 0"
>
	<div data-pull-icon class="p-2 rounded-full bg-primary/10 border border-primary/20">
		<RefreshCw class="h-5 w-5 text-primary/60" />
	</div>
</div>
