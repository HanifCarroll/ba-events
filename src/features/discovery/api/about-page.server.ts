import { getEnabledInstagramSourceCount } from '#shared/lib/db/client.server.ts'
import * as m from '#paraglide/messages.js'
import { getSiteUrl } from '#shared/lib/utils/url.ts'
import { setDiscoveryHeaders } from './agenda-page.server.ts'
import { fillCopy, pageCopy } from '../lib/copy.ts'
import copy from '../lib/about-copy.json'

export const aboutPaths = ['/que-es-ba-eventos', '/en/about'] as const

export async function loadAboutPage(path: typeof aboutPaths[number], setHeaders: (headers: Record<string, string>) => void, signedIn: boolean) {
  const sources = await getEnabledInstagramSourceCount()
  const lang = path === '/en/about' ? 'en' as const : 'es' as const
  const page = copy[path]
  const rounded = Math.floor(sources / 10) * 10
  const values = {
    n_cuentas: rounded && rounded < sources ? `más de ${rounded} cuentas` : `${sources} ${sources === 1 ? 'cuenta' : 'cuentas'}`,
    n_accounts: rounded && rounded < sources ? `more than ${rounded} accounts` : `${sources} ${sources === 1 ? 'account' : 'accounts'}`,
    mes_anio: 'noviembre de 2026',
    month_year: 'November 2026',
    feedback_label: m.nav_feedback({}, { locale: lang }),
  }
  setDiscoveryHeaders(setHeaders, signedIn)
  return { ...pageCopy(page, values), path, lang, canonical: getSiteUrl() + path,
    blocks: page.body.split('\n\n').map(block => fillCopy(block, values)) }
}

export type AboutPageData = Awaited<ReturnType<typeof loadAboutPage>>
