import { expect, it } from 'vitest'
import { renderSitemapXml } from './sitemap-xml.ts'

it('escapes XML entities in URLs and omits an unknown last modification date', () => {
  const xml = renderSitemapXml([{ loc: `https://baeventos.com/events/jazz&blues?a="<x>"&b='y'` }])
  expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://baeventos.com/events/jazz&amp;blues?a=&quot;&lt;x&gt;&quot;&amp;b=&apos;y&apos;</loc>
  </url>
</urlset>
`)
})
