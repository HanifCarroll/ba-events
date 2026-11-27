import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const [localUrl, eventId, startsAt] = process.argv.slice(2)
assert.ok(localUrl && eventId && startsAt, 'Usage: node scripts/check-agenda-start-date-browser.mjs <local-url> <ongoing-event-id> <start-iso>')
const url = new URL(localUrl)
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'use an isolated localhost fixture')
const dateLabel = new Intl.DateTimeFormat('es', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Argentina/Buenos_Aires',
}).format(new Date(startsAt))

const browser = await chromium.launch()
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'es-AR', serviceWorkers: 'block', javaScriptEnabled: false,
  })
  await context.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort())
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(120_000)
  for (const path of ['/agenda/gratis', '/']) {
    assert.equal((await page.goto(new URL(path, url).href, { waitUntil: 'domcontentloaded' }))?.status(), 200, path)
    const card = page.locator('[data-section="event-card"]').filter({
      has: page.locator(`a[href="/events/${encodeURIComponent(eventId)}"]`),
    })
    assert.equal(await card.count(), 1, `${path}: the ongoing fixture should appear once`)
    const day = card.locator('xpath=preceding-sibling::h2[@data-section="day"][1]')
    assert.equal(await day.textContent(), 'Hoy', `${path}: the ongoing fixture belongs under Hoy`)
    assert.ok(await day.isVisible(), `${path}: Hoy is visible on mobile`)
    const date = card.getByText(dateLabel, { exact: true })
    assert.ok(await date.isVisible(), `${path}: ${dateLabel} is visible at 390 px`)
    assert.equal(await date.getAttribute('datetime'), startsAt)
    console.log(`PASS ${path}: ${dateLabel} stays visible under Hoy at 390 px without JavaScript`)
  }
} finally {
  await browser.close()
}
