<script lang="ts">
	import type { LayoutProps } from './$types'
	import ChatPage from '#features/chat/components/ChatPage.svelte'

	let { children: _children }: LayoutProps = $props()
</script>

<ChatPage />
{@render _children()}
