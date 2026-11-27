export type SitemapUrl = { loc: string; lastmod?: string }

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function renderSitemapXml(urls: readonly SitemapUrl[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(({ loc, lastmod }) => [
      '  <url>',
      `    <loc>${escapeXml(loc)}</loc>`,
      ...(lastmod === undefined ? [] : [`    <lastmod>${escapeXml(lastmod)}</lastmod>`]),
      '  </url>',
    ].join('\n')),
    '</urlset>',
    '',
  ].join('\n')
}
