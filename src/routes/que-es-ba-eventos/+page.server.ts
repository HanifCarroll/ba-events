import { loadAboutPage } from '#features/discovery/api/about-page.server.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ setHeaders, locals }) => loadAboutPage('/que-es-ba-eventos', setHeaders, Boolean(locals.user))
