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
		crop = false,
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
		crop?: boolean
		alt?: string
		loading?: 'lazy' | 'eager'
		fetchpriority?: 'high' | 'low' | 'auto'
		class?: string
	} = $props()

	let failedUrl = $state<string | null>(null)
	const sources = $derived(eventId && failedUrl !== imageUrl && isArtworkOriginAllowed(imageUrl)
		? artworkSrcset(eventId, imageUrl, imageWidth) : undefined)
	const ratio = $derived(crop ? '4 / 5' : aspectRatio ?? getArtworkAspectRatio(imageWidth, imageHeight))
</script>

<div class={`flex items-center justify-center overflow-hidden rounded-xl bg-muted/40 ${className}`} style:aspect-ratio={ratio}>
	<picture class="contents">
		{#if sources}<source type="image/webp" srcset={sources} {sizes} />{/if}
		<img
			src={imageUrl}
			{alt}
			width={crop ? 320 : imageWidth ?? undefined}
			height={crop ? 400 : imageHeight ?? undefined}
			{loading}
			{fetchpriority}
			decoding="async"
			onerror={() => { failedUrl = imageUrl }}
			style:max-width={!crop && ratio && imageWidth ? `min(100%, ${imageWidth}px)` : undefined}
			style:max-height={!crop && ratio && imageHeight ? `min(100%, ${imageHeight}px)` : undefined}
			class={['block', ratio ? 'h-full w-full' : 'max-h-full max-w-full', crop ? 'object-cover' : 'object-contain']}
		/>
	</picture>
</div>
