<script lang="ts">
	import { page } from '$app/state'

	const message = $derived(page.status === 404
		? page.error?.message ?? 'No encontramos ese lugar.'
		: 'No pudimos cargar este lugar.')
</script>

<svelte:head>
	<title>{message} | BA Eventos</title>
</svelte:head>

<section class="h-full overflow-y-auto bg-[#101012] px-4 py-12 text-[#eeeeef] sm:px-8 lg:px-12">
	<div class="mx-auto max-w-[90rem] space-y-4">
		<p class="text-sm text-[#ccccd4]">{page.status}</p>
		<h1 class="font-display text-3xl font-bold sm:text-4xl">{message}</h1>
		<a href="/agenda/barrios" class="inline-flex min-h-11 items-center text-[#d0ff36] underline underline-offset-4">Ver la agenda por barrio</a>
	</div>
</section>
