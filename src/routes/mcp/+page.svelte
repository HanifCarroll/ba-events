<script lang="ts">
	import { ArrowLeft, Check, Copy } from 'lucide-svelte'
	import { getLocale } from '#paraglide/runtime.js'
	import * as m from '#paraglide/messages.js'
	import { track } from '#shared/lib/analytics.ts'
	import { getSiteUrl } from '#shared/lib/utils/url.ts'

	const endpoint = 'https://baeventos-mcp.paseaban-decorosa0m.workers.dev/mcp'
	const locale = getLocale() === 'es' ? 'es' : 'en'
	let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle')

	async function copyEndpoint() {
		try {
			await navigator.clipboard.writeText(endpoint)
			copyStatus = 'copied'
			track('mcp:endpoint_copied')
		} catch {
			copyStatus = 'failed'
		}
	}

	const title = m.mcp_title()
	const description = m.mcp_intro()
	const siteUrl = getSiteUrl()
</script>

<svelte:head>
	<title>{title} | BA Eventos</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={`${siteUrl}/mcp`} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="BA Eventos" />
	<meta property="og:title" content={`${title} | BA Eventos`} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={`${siteUrl}/mcp`} />
	<meta property="og:locale" content={locale === 'es' ? 'es_AR' : 'en_US'} />
	<meta property="og:image" content={`${siteUrl}/og-image-2026.jpg`} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={`${title} | BA Eventos`} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={`${siteUrl}/og-image-2026.jpg`} />
</svelte:head>

<div class="h-full overflow-auto px-5 py-10 sm:px-8 sm:py-16">
	<article class="mx-auto max-w-3xl pb-12">
		<a href="/" class="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
			<ArrowLeft class="size-4" aria-hidden="true" />
			{m.mcp_back()}
		</a>

		<header class="mt-12 max-w-2xl">
			<p class="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{m.mcp_beta_label()}</p>
			<h1 class="font-display mt-4 text-4xl leading-tight tracking-tight sm:text-6xl">{title}</h1>
			<p class="mt-6 text-lg leading-8 text-muted-foreground">{description}</p>
		</header>

		<div class="mt-12 space-y-12">
			<section aria-labelledby="endpoint-heading">
				<h2 id="endpoint-heading" class="font-display text-2xl">{m.mcp_endpoint_label()}</h2>
				<div class="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
					<code class="min-w-0 break-all text-sm leading-6 text-foreground">{endpoint}</code>
					<button type="button" onclick={copyEndpoint} class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
						{#if copyStatus === 'copied'}<Check class="size-4" aria-hidden="true" />{:else}<Copy class="size-4" aria-hidden="true" />{/if}
						{copyStatus === 'copied' ? m.mcp_endpoint_copied() : m.mcp_copy_endpoint()}
					</button>
				</div>
				<p class="mt-2 min-h-6 text-sm text-muted-foreground" aria-live="polite">
					{#if copyStatus === 'failed'}{m.mcp_endpoint_copy_failed()}{/if}
				</p>
			</section>

			<section aria-labelledby="connect-heading">
				<h2 id="connect-heading" class="font-display text-2xl">{m.mcp_connect_title()}</h2>
				<p class="mt-3 leading-7 text-muted-foreground">{m.mcp_connect_body()}</p>
				<pre class="mt-4 overflow-x-auto rounded-xl bg-[#11152d] p-4 text-sm leading-7 text-white"><code>codex mcp add baeventos --url {endpoint}</code></pre>
				<p class="mt-3 text-sm text-muted-foreground">{m.mcp_tested_with_codex()}</p>
			</section>

			<section aria-labelledby="tools-heading">
				<h2 id="tools-heading" class="font-display text-2xl">{m.mcp_tools_title()}</h2>
				<ul class="mt-4 space-y-4 leading-7 text-muted-foreground">
					<li><code class="font-semibold text-foreground">search_events</code> — {m.mcp_search_events()}</li>
					<li><code class="font-semibold text-foreground">get_event</code> — {m.mcp_get_event()}</li>
				</ul>
			</section>

			<section class="border-y border-border/70 py-10" aria-labelledby="example-heading">
				<h2 id="example-heading" class="font-display text-2xl">{m.mcp_example_title()}</h2>
				<p class="mt-4 rounded-xl bg-primary/[0.07] px-4 py-4 text-base leading-7 text-foreground">“{m.mcp_example()}”</p>
				<h3 class="font-display mt-8 text-xl">{m.mcp_limits_title()}</h3>
				<p class="mt-3 leading-7 text-muted-foreground">{m.mcp_limits()}</p>
			</section>
		</div>

		<footer class="mt-14 flex flex-wrap gap-x-6 gap-y-3 border-t border-border/70 pt-6 text-sm">
			<a href="/" class="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{m.mcp_back()}</a>
			<a href="/privacy" class="inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{m.mcp_privacy()}</a>
		</footer>
	</article>
</div>
