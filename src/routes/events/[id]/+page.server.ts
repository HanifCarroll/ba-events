import type { PageServerLoad } from './$types'
import { Effect } from 'effect'
import { getEventDetailDataEffect } from '#features/events/api/detail.server.ts'

export const load: PageServerLoad = async ({ params }) => Effect.runPromise(getEventDetailDataEffect(params.id))
