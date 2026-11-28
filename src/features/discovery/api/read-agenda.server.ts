import { getDiscoveryAgendaEvents } from '#shared/lib/db/client.server.ts'
import { homeWindow } from '#features/events/lib/home-feed.ts'
import type { DiscoverySnapshot } from '../lib/agenda-pages.ts'

export async function readDiscoveryAgenda(now = new Date()): Promise<DiscoverySnapshot> {
  const window = homeWindow(now)
  return { asOf: now.getTime(), window, events: await getDiscoveryAgendaEvents(window) }
}
