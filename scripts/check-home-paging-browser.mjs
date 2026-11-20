import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run against the isolated homepage fixture described in docs/development.md.
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

async function checkComposerPlacement(javaScriptEnabled) {
  const context = await browser.newContext({ ...profile, isMobile: false, hasTouch: false, userAgent: undefined, javaScriptEnabled })
  const label = javaScriptEnabled ? 'hydrated' : 'JavaScript disabled'
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const filtered = new URL(url)
    filtered.searchParams.set('f', 'musica')
    const agenda = page.locator('[data-section="agenda"]')
    const chat = agenda.locator('[data-section="chat"]')
    const cards = agenda.locator('[data-section="event-card"]')
    const textbox = chat.getByRole('textbox', { name: 'Contame qué estás buscando' })
    const checks = []
    for (const [width, slots] of [[390, 6], [768, 6], [1024, 8], [1280, 8], [1440, 10]]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      assert.equal((await page.goto(filtered.href)).status(), 200)
      const total = await cards.count()
      assert.equal(total, 8, 'seed exactly eight Music cards to exercise a short desktop grid')
      assert.equal(await chat.count(), 1)
      if (javaScriptEnabled) {
        await page.locator('.home').evaluate(el => { el.scrollTop = el.scrollHeight })
        await page.getByRole('button', { name: 'Volver arriba' }).waitFor()
      }
      const composer = await chat.boundingBox()
      const positions = await Promise.all(Array.from({ length: total }, (_, index) => cards.nth(index).boundingBox()))
      const expected = Math.min(total, slots)
      const placement = positions.map(card => card.y + card.height <= composer.y ? 'before' : card.y >= composer.y + composer.height ? 'after' : 'overlap')
      const expectedPlacement = [...Array(expected).fill('before'), ...Array(total - expected).fill('after')]
      checks.push({ width, placement: placement.join(' '), expected: expectedPlacement.join(' ') })
    }
    assert.deepEqual(checks.filter(({ placement, expected }) => placement !== expected), [])
    assert.equal(await textbox.count(), 1, 'the composer must have a descriptive accessible name')
    if (await page.evaluate(() => CSS.supports('reading-flow', 'grid-rows'))) {
      await cards.last().getByRole('button', { name: 'Preguntar por este evento' }).focus()
      await page.keyboard.press('Tab')
      assert.ok(await textbox.evaluate(el => el === document.activeElement), 'Tab from the last visual card must reach the composer')
    }
    console.log(`PASS direct Music filter (${label}): ${checks.map(({ width, placement }) => `${width}px=${placement.split(' ').filter(area => area === 'before').length}/8`).join(', ')}`)
  } catch (error) {
    console.error(`FAIL direct Music filter (${label})`, error)
    process.exitCode = 1
  } finally {
    await context.close()
  }
}

try {
  await checkComposerPlacement(false)
  await checkComposerPlacement(true)
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
      const positionComposer = offset => scroller.locator('[data-section="chat"] form').evaluate((form, offset) => {
        const scrollport = form.closest('.home')
        const button = scrollport.querySelector('.back-to-top').getBoundingClientRect()
        scrollport.scrollTop += form.getBoundingClientRect().bottom - button.top - offset
        const rect = form.getBoundingClientRect()
        return {
          pastThreshold: scrollport.scrollTop > 2 * scrollport.clientHeight,
          horizontalOverlap: rect.right > button.left && rect.left < button.right,
          gap: button.top - rect.bottom,
        }
      }, offset)
      const overlap = await positionComposer(4)
      assert.ok(overlap.pastThreshold && overlap.horizontalOverlap)
      assert.ok(overlap.gap < 0, `expected actual button overlap, gap=${overlap.gap}`)
      await button.waitFor({ state: 'hidden' })
      const inside = await positionComposer(-7)
      assert.ok(inside.gap > 0 && inside.gap < 8)
      await button.waitFor({ state: 'hidden' })
      const clear = await positionComposer(-9)
      assert.ok(clear.gap > 8)
      await button.waitFor({ state: 'visible' })
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
