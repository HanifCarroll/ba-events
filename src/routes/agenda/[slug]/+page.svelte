<script lang="ts">
	import AgendaPage from '#features/discovery/components/AgendaPage.svelte'
	import type { PageProps } from './$types'
	let { data }: PageProps = $props()
</script>

<AgendaPage {data} />
