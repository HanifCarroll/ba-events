<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="h-full flex items-center justify-center p-6">
	<div class="text-center">
		<div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10 mb-4">
			<span class="text-destructive text-xl">!</span>
		</div>
		<h2 class="font-display text-lg font-medium mb-2">Authentication Error</h2>
		<p class="text-muted-foreground text-sm mb-4">{data.error}</p>
		<a href="/login" class="text-primary hover:text-primary/80 text-sm font-medium transition-colors">
			Return to login
		</a>
	</div>
</div>
