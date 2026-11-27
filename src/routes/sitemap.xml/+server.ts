import type { RequestHandler } from './$types'
import { readSitemapUrls } from '#features/sitemap/api/sitemap-urls.server.ts'
import { renderSitemapXml } from '#features/sitemap/lib/sitemap-xml.ts'

export const GET = (async () => {
  const xml = renderSitemapXml(await readSitemapUrls(new Date()))
  return new Response(xml, { headers: {
    'Content-Type': 'application/xml; charset=utf-8',
    // The Cloudflare adapter stores cacheable responses in caches.default.
    'Cache-Control': 'public, max-age=0, s-maxage=3600',
  } })
}) satisfies RequestHandler
