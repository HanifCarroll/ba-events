<script lang="ts">
	import AboutPage from '#features/discovery/components/AboutPage.svelte'
	import type { PageProps } from './$types'
	let { data }: PageProps = $props()
</script>

<AboutPage {data} />
