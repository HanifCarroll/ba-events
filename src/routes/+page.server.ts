import type { PageServerLoad } from './$types'
import { getHappeningSoonEventsForGrid } from '#features/events/api/crud.server.ts'

// Prefetch happening-soon events so the home cards render on first paint.
export const load: PageServerLoad = async () => {
	const happeningSoon = await getHappeningSoonEventsForGrid()
	return { happeningSoon }
}
