import { getHappeningSoonEventsForGrid } from '#features/events/api/crud.server.ts'
import { apiList, withCache } from '#shared/lib/api-response.ts'

/** Public, bounded feed for the homepage's below-fold event cards. */
export const GET = async (): Promise<Response> => {
	const events = await getHappeningSoonEventsForGrid()
	return Response.json(
		apiList(events, events.length),
		{ headers: withCache({ 'Content-Type': 'application/json' }, 'short') }
	)
}
