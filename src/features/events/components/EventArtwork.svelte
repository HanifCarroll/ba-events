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
		blurFill = false,
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
		blurFill?: boolean
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

{#snippet artwork(decorative: boolean)}
	<picture class="contents" aria-hidden={decorative || undefined}>
		{#if sources}<source type="image/webp" srcset={sources} {sizes} />{/if}
		<img
			src={imageUrl}
			alt={decorative ? '' : alt}
			width={crop ? 320 : imageWidth ?? undefined}
			height={crop ? 400 : imageHeight ?? undefined}
			{loading}
			fetchpriority={decorative ? undefined : fetchpriority}
			decoding="async"
			onerror={() => { failedUrl = imageUrl }}
			style:max-width={!decorative && !crop && ratio && imageWidth ? `min(100%, ${imageWidth}px)` : undefined}
			style:max-height={!decorative && !crop && ratio && imageHeight ? `min(100%, ${imageHeight}px)` : undefined}
			class={['block', decorative ? 'pointer-events-none absolute inset-0 -z-10 size-full scale-110 object-cover blur-xl brightness-50' : [
				ratio ? 'h-full w-full' : 'max-h-full max-w-full', crop ? 'object-cover' : 'object-contain'
			]]}
		/>
	</picture>
{/snippet}

<div class={`flex items-center justify-center overflow-hidden rounded-xl bg-muted/40 ${blurFill ? 'relative isolate' : ''} ${className}`} style:aspect-ratio={ratio}>
	{@render artwork(false)}
	{#if blurFill}{@render artwork(true)}{/if}
</div>
