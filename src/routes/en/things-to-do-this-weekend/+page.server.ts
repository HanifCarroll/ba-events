import { loadAgendaPage } from '#features/discovery/api/agenda-page.server.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ setHeaders, locals }) => loadAgendaPage('/en/things-to-do-this-weekend', setHeaders, Boolean(locals.user))
