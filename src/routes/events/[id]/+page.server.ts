import type { PageServerLoad } from './$types'
import { getEventDetailData } from '#features/events/api/detail.server.ts'

export const load: PageServerLoad = async ({ params }) => getEventDetailData(params.id)
