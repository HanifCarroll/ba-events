import { loadAboutPage } from '#features/discovery/api/about-page.server.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ setHeaders, locals }) => loadAboutPage('/en/about', setHeaders, Boolean(locals.user))
