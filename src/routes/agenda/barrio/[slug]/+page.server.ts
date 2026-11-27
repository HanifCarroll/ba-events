import { loadBarrioPage } from '#features/discovery/api/place-page.server.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ params, setHeaders, locals }) => loadBarrioPage(params.slug, setHeaders, Boolean(locals.user))
