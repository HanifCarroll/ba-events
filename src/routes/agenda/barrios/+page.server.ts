import { loadBarrioIndex } from '#features/discovery/api/place-page.server.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ setHeaders, locals }) => loadBarrioIndex(setHeaders, Boolean(locals.user))
