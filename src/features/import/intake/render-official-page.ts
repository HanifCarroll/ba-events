import type { OpenBrowser, OwnedBrowser } from '../acquisition/run.ts'
import { FANZ_SINGLE_DATE, publicPageUrl, renderedPageRead, requireOfficialPageUrl, type RenderPage } from './official-page.ts'

const RENDER_MS = 10_000
const READ_LIMIT = 2_097_153 // One extra character lets the reader distinguish a too-large result from a complete one.

// Chromium's innerText includes transparent text and aria-hidden slides. Exclude their entire subtrees for this read.
const visibleBody = `
  const shown = el => el?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const body = document.body;
  const readVisible = read => {
    if (!shown(body) || body.closest('[hidden], [aria-hidden="true"]')) return read('');
    const hidden = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, el => {
      const style = getComputedStyle(el);
      if (style.display === 'none') return NodeFilter.FILTER_REJECT;
      if (!el.matches('[hidden], [aria-hidden="true"]') && Number(style.opacity) !== 0) return NodeFilter.FILTER_ACCEPT;
      hidden.push([el, el.getAttribute('style')]);
      return NodeFilter.FILTER_REJECT;
    });
    while (walker.nextNode()) {}
    for (const [el] of hidden) el.style.setProperty('display', 'none', 'important');
    try { return read(body.innerText.slice(0, ${READ_LIMIT})); }
    finally {
      for (const [el, style] of hidden) {
        if (style === null) el.removeAttribute('style');
        else el.setAttribute('style', style);
      }
    }
  };
`

/** One disposable anonymous browser; share the result, not its cookies or its page, within a verification. */
export function officialPageRenderer(open: OpenBrowser): RenderPage {
  return async (url, sites, excerpts) => {
    requireOfficialPageUrl(url, sites, false)
    let owned: OwnedBrowser | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let expired = false
    const deadline = Date.now() + RENDER_MS
    const remaining = () => Math.max(1, deadline - Date.now())
    const work = async () => {
      owned = await open()
      try {
        if (expired) throw new Error('browser rendering timed out')
        const page = await owned.browser.newPage({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
          serviceWorkers: 'block', acceptDownloads: false })
        const cdp = await page.context().newCDPSession(page)
        const { frameTree } = await cdp.send('Page.getFrameTree')
        let blocked: Error | undefined
        await cdp.send('Network.enable')
        cdp.on('Network.requestWillBeSentExtraInfo', ({ headers }) => {
          if (Object.entries(headers).some(([name, value]) => /^cookie$/i.test(name) && value.trim())) {
            blocked = new Error('browser could not keep the official page read anonymous')
          }
        })
        // Playwright routes see only the first hop. Pause every Chromium request before it can follow a redirect.
        cdp.on('Fetch.requestPaused', ({ requestId, request, resourceType, frameId }) => {
          const mainNavigation = resourceType === 'Document' && frameId === frameTree.frame.id
          // Anonymous GETs can need a CORS preflight; never send a write from an evidence page.
          let allow = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) && publicPageUrl(request.url) && !['Image', 'Media', 'Font'].includes(resourceType)
          if (resourceType === 'Document') {
            if (!mainNavigation) allow = false
            else {
              try { requireOfficialPageUrl(request.url, sites, request.url !== url) }
              catch (error) { blocked = error as Error; allow = false }
            }
          }
          const refuse = () => cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
          // Chrome attaches cookies after Fetch's request event. Clear this disposable browser's jar before proceeding.
          const release = allow && !blocked ? cdp.send('Network.clearBrowserCookies').then(
            () => blocked ? refuse() : cdp.send('Fetch.continueRequest', { requestId }),
            () => { blocked = new Error('browser could not clear cookies before reading the official page'); return refuse() },
          ) : refuse()
          void release.catch(() => {}) // A request can disappear when the browser closes.
        })
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(6_000, remaining()) })
          .catch(() => { throw blocked ?? new Error('browser could not load the official page') })
        for (let request = response?.request(); request; request = request.redirectedFrom() ?? undefined) {
          requireOfficialPageUrl(request.url(), sites, request.url() !== url)
        }
        // Wait briefly for hydration, but still read the page if a particular excerpt never appears.
        if (response?.ok()) await page.waitForFunction(`(() => {
          ${visibleBody}
          return readVisible(visible => {
            const text = visible.normalize('NFD').replace(/\\p{M}/gu, '').toLowerCase().replace(/\\s+/g, ' ').trim();
            return ${JSON.stringify(excerpts.map(excerpt => excerpt.source))}.every(source => new RegExp(source, 'u').test(text));
          });
        })()`, undefined, { polling: 150, timeout: Math.min(3_000, remaining()) }).catch(() => {})
        // Pass a string: the Worker bundler's function-name helpers do not exist in the browser.
        const snapshot = await page.evaluate<Parameters<typeof renderedPageRead>[1]>(`(() => {
          ${visibleBody}
          return readVisible(visible => {
            const cards = [...document.querySelectorAll(${JSON.stringify(FANZ_SINGLE_DATE)})].filter(shown);
            return {
              url: location.href,
              visible,
              title: document.title.trim(),
              headings: [...document.querySelectorAll('h1')].filter(shown).map(el => el.innerText.trim()),
              siteName: document.querySelector('meta[property="og:site_name"]')?.content ?? null,
              fanzLinks: [...document.querySelectorAll('a[href*="fanz.com.ar"]')].map(el => el.getAttribute('href')),
              fanzJson: document.querySelector('script#__NEXT_DATA__[type="application/json"]:not([src])')?.textContent?.slice(0, ${READ_LIMIT}) ?? '',
              singleDate: cards.length === 1 ? cards[0].innerText : '',
              challenge: ${!response?.ok()} || [...document.querySelectorAll('#challenge-form, iframe[src*="_Incapsula_Resource"]')].some(shown) ||
                (visible.length < 500 && /incapsula incident id|please enable javascript and cookies to continue/i.test(visible)),
            };
          });
        })()`)
        if (blocked) throw blocked
        requireOfficialPageUrl(snapshot.url, sites, snapshot.url !== url)
        return renderedPageRead(url, snapshot)
      } finally {
        await owned.close()
      }
    }
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true
          if (owned) void owned.close().catch(() => {})
          reject(new Error('browser rendering timed out'))
        }, RENDER_MS)
      })])
    } finally { clearTimeout(timer) }
  }
}
