<script lang="ts">
	import { getArtworkAspectRatio } from '../lib/event-art.ts'

	let {
		imageUrl,
		imageWidth = null,
		imageHeight = null,
		aspectRatio = null,
		alt = '',
		loading = 'lazy',
		fetchpriority = 'auto',
		class: className = ''
	}: {
		imageUrl: string
		imageWidth?: number | null
		imageHeight?: number | null
		aspectRatio?: string | null
		alt?: string
		loading?: 'lazy' | 'eager'
		fetchpriority?: 'high' | 'low' | 'auto'
		class?: string
	} = $props()

	const ratio = $derived(aspectRatio ?? getArtworkAspectRatio(imageWidth, imageHeight))
</script>

<div class={`flex items-center justify-center overflow-hidden rounded-xl bg-muted/40 ${className}`} style:aspect-ratio={ratio}>
	<img
		src={imageUrl}
		{alt}
		width={imageWidth ?? undefined}
		height={imageHeight ?? undefined}
		{loading}
		{fetchpriority}
		class="block max-h-full max-w-full object-contain"
	/>
</div>
