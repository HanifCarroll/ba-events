import { loadAgendaPage } from '#features/discovery/api/agenda-page.server.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ params, setHeaders, locals }) =>
  loadAgendaPage(`/agenda/${params.slug}`, setHeaders, Boolean(locals.user))
