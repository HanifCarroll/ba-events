import { getUpcomingEventSitemapRows } from '#shared/lib/db/client.server.ts'
import { getEventUrl, getSiteUrl } from '#shared/lib/utils/url.ts'
import type { SitemapUrl } from '../lib/sitemap-xml.ts'

/** Collect the canonical URLs for each page family in one place. */
export async function readSitemapUrls(asOf: Date): Promise<SitemapUrl[]> {
  const siteUrl = getSiteUrl()
  const events = await getUpcomingEventSitemapRows(asOf)
  return [
    { loc: siteUrl },
    { loc: `${siteUrl}/mcp` },
    ...events.map(({ id, updated_at }) => ({ loc: getEventUrl(id), lastmod: updated_at })),
  ]
}
