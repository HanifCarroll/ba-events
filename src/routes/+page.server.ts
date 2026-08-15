import type { PageServerLoad } from './$types'
import { getTrendingEventsForGrid } from '#features/events/api/crud.server.ts'

// Prefetch trending events so the "Happening soon" cards render on first paint
// (no skeleton gap). The legacy index.tsx loader ran `getTrendingEventsAction()`
// and TrendingEvents seeded its TanStack Query with the result via `initialData`.
// Here the load result flows through `page.data` to the TrendingEvents component
// (U1). The legacy query's `staleTime: 5 * 60 * 1000` refetch had no
// user-visible trigger on the home screen, so there is no client refetch to
// port (see evidence).
export const load: PageServerLoad = async () => {
	const trending = await getTrendingEventsForGrid()
	return { trending }
}
