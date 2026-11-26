<script lang="ts">
	import { page } from '$app/state'
	import type { LayoutProps, PageData } from './$types'
	import ChatPage from '#features/chat/components/ChatPage.svelte'
	import type { LandingPromptHandler } from '#features/chat/lib/landing-prompt.ts'
	import HomePage from './HomePage.svelte'

	let { children }: LayoutProps = $props()
</script>

{#snippet home(onSelectPrompt: LandingPromptHandler)}
	<HomePage homeAgenda={page.data.homeAgenda as PageData['homeAgenda']} {onSelectPrompt} />
{/snippet}

<!-- Keep ChatPage mounted when the first turn moves from / to /chat/:conversationId. -->
<ChatPage landing={page.url.pathname === '/' ? home : undefined} />
{@render children()}
