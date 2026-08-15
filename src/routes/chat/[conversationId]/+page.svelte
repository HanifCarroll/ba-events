<script lang="ts">
	import ChatPage from '#features/chat/components/ChatPage.svelte'
</script>

<!--
	Same as the legacy `chat_.$conversationId.tsx`: `component: ChatPage` with no
	props. ChatPage reads `page.params.conversationId` / `page.data` itself.
-->
<ChatPage />
