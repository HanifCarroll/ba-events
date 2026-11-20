import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run against a local build seeded with at least 25 agenda cards. No public requests.
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:3001/')
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'use an isolated localhost fixture')
const browser = await chromium.launch({ channel: 'chrome' })
const profile = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'es-AR',
}

async function check(name, reducedMotion, run) {
  const context = await browser.newContext({ ...profile, reducedMotion })
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    assert.equal((await page.goto(url.href)).status(), 200)
    const scroller = page.locator('.home')
    const backToTop = page.getByRole('button', { name: 'Volver arriba' })
    await scroller.evaluate(el => { el.scrollTop = 3 * el.clientHeight })
    await backToTop.waitFor({ state: 'visible' })
    await run(page, scroller, backToTop)
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`, error)
    process.exitCode = 1
  } finally {
    await context.close()
  }
}

try {
  await check('tap near top of viewport reveals card 25 without a scroll jump', 'reduce', async (page, scroller) => {
    // At full phone height the footer now ends too soon to scroll the pager to the top.
    await page.setViewportSize({ width: 390, height: 390 })
    const cards = scroller.locator('article')
    const more = page.getByRole('link', { name: 'Ver más' })
    assert.equal(await cards.count(), 24)
    await more.evaluate(el => { el.closest('.home').scrollTop += el.getBoundingClientRect().top - 8 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const { y } = await more.boundingBox()
    assert.ok(y >= 0 && y < 160, `pager was not near the top: y=${y}`)
    const before = await scroller.evaluate(el => ({ top: el.scrollTop, document: performance.timeOrigin }))
    await more.tap()
    await cards.nth(24).waitFor()
    const after = await scroller.evaluate(el => ({ top: el.scrollTop, document: performance.timeOrigin }))
    const card = await cards.nth(24).boundingBox()
    assert.ok(card.y < page.viewportSize().height && card.y + card.height > 0, `card 25 is outside the viewport: y=${card.y}`)
    assert.deepEqual(after, before)
    console.log(`pager y=${y}, card 25 y=${card.y}, scrollTop=${after.top}`)
  })

  await check('back to top at the end of a short filtered agenda', 'reduce', async (page, scroller, button) => {
    const filtered = new URL(url)
    filtered.searchParams.set('f', 'gratis')
    assert.equal((await page.goto(filtered.href)).status(), 200)
    await button.waitFor({ state: 'hidden' })
    const atShortFooter = await scroller.evaluate(el => {
      el.scrollTop = el.scrollHeight
      return el.scrollTop > 0 && el.scrollTop <= 2 * el.clientHeight
    })
    assert.ok(atShortFooter, 'seed a scrollable Free agenda shorter than three viewport heights')
    await button.waitFor({ state: 'visible' })
  })

  for (const reducedMotion of ['reduce', 'no-preference']) {
    await check(`back to top at the footer (${reducedMotion})`, reducedMotion, async (page, scroller, button) => {
      await scroller.evaluate(el => { el.scrollTop = el.scrollHeight })
      await scroller.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await button.waitFor({ state: 'visible' })
      const buttonRect = await button.boundingBox()
      assert.ok(buttonRect.width >= 44 && buttonRect.height >= 44)
      await page.setViewportSize({ width: 390, height: 280 })
      const nearComposer = await scroller.locator('[data-section="chat"] form').evaluate(el => {
        const scrollport = el.closest('.home')
        scrollport.scrollTop += el.getBoundingClientRect().top - scrollport.getBoundingClientRect().top - scrollport.clientHeight * 0.8
        return scrollport.scrollTop > 2 * scrollport.clientHeight
      })
      assert.ok(nearComposer, 'composer overlap check must scroll past the visibility threshold')
      await button.waitFor({ state: 'hidden' })
      await page.setViewportSize(profile.viewport)
      await scroller.evaluate(el => {
        el.scrollTop = el.scrollHeight
        const scrollTo = el.scrollTo.bind(el)
        el.scrollTo = options => {
          scrollTo(options)
          window.homeScroll = { behavior: options.behavior, immediateTop: el.scrollTop }
        }
      })
      await button.waitFor({ state: 'visible' })
      await button.tap()
      const { behavior, immediateTop } = await page.evaluate(() => window.homeScroll)
      assert.equal(behavior, reducedMotion === 'reduce' ? 'instant' : 'smooth')
      assert.equal(immediateTop === 0, reducedMotion === 'reduce')
      await page.waitForFunction(() => document.querySelector('.home').scrollTop === 0)
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H1')
    })
  }
} finally {
  await browser.close()
}
