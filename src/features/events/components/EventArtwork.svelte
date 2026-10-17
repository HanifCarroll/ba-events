<script lang="ts">
	import { artworkSrcset, isArtworkOriginAllowed } from '../lib/artwork-delivery.ts'
	import { getArtworkAspectRatio } from '../lib/event-art.ts'

	let {
		imageUrl,
		eventId,
		sizes = '100vw',
		imageWidth = null,
		imageHeight = null,
		aspectRatio = null,
		alt = '',
		loading = 'lazy',
		fetchpriority = 'auto',
		class: className = ''
	}: {
		imageUrl: string
		eventId?: string
		sizes?: string
		imageWidth?: number | null
		imageHeight?: number | null
		aspectRatio?: string | null
		alt?: string
		loading?: 'lazy' | 'eager'
		fetchpriority?: 'high' | 'low' | 'auto'
		class?: string
	} = $props()

	let failedUrl = $state<string | null>(null)
	const sources = $derived(eventId && failedUrl !== imageUrl && isArtworkOriginAllowed(imageUrl)
		? artworkSrcset(eventId, imageUrl) : undefined)
	const ratio = $derived(aspectRatio ?? getArtworkAspectRatio(imageWidth, imageHeight))
</script>

<div class={`flex items-center justify-center overflow-hidden rounded-xl bg-muted/40 ${className}`} style:aspect-ratio={ratio}>
	<picture class="contents">
		{#if sources}<source type="image/webp" srcset={sources} {sizes} />{/if}
		<img
			src={imageUrl}
			{alt}
			width={imageWidth ?? undefined}
			height={imageHeight ?? undefined}
			{loading}
			{fetchpriority}
			decoding="async"
			onerror={() => { failedUrl = imageUrl }}
			class="block max-h-full max-w-full object-contain"
		/>
	</picture>
</div>
