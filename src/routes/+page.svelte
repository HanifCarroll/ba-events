<script lang="ts">
	import ChatPage from '#features/chat/components/ChatPage.svelte'
</script>

<!--
	The home route IS ChatPage, exactly as the legacy index.tsx composed
	`component: ChatPage` (no props — ChatPage reads route params/data itself
	via $app/state, the Svelte mapping of useParams/useLoaderData).
-->
<ChatPage />
