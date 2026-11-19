import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { run } from './runtime.ts'
import { exactMentionOption, StoryComposerError, type ComposeStory, type StickerFrame } from './story-stickers.ts'

const COMPOSER_URL = new URL('https://business.facebook.com/latest/story_composer/?asset_id=1442212152312492&business_id=1500991868617721')
const ACCOUNT = 'baeventos.app'
const STEP_MS = 12_000
const MENTION_LOOKUP_MS = 5_000
const FLOW_MS = 6 * 60_000
const SIGN_IN_TEXT = 'Unable to access Meta Business Suite'
const PREVIEW_IMAGE = '#instagram_story_preview_media'
const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true })
const text = (page: Page, value: string) => page.getByText(value, { exact: true })
const photoEditor = (page: Page) => page.getByRole('dialog', { name: 'Edit photo', exact: true })

export function needsFacebookSignIn(url: string, message = ''): boolean {
  return /^(?:https?:\/\/(?:[^./]+\.)*facebook\.com)(?::\d+)?\/(?:login(?:\.php)?|checkpoint|auth_platform)(?:[/?#]|$)/i.test(url)
    || url.startsWith('chrome-error://') || /ERR_TOO_MANY_REDIRECTS/i.test(message) || message.includes(SIGN_IN_TEXT)
}

async function endpoint(): Promise<string> {
  if (process.env.BA_INSTAGRAM_STICKERS_CDP) return process.env.BA_INSTAGRAM_STICKERS_CDP
  if (process.platform === 'darwin') return 'http://127.0.0.1:9333'
  const helper = join(homedir(), '.agents/skills/remote-desktop/scripts/rbrowser')
  const result = await run([helper, 'pro', 'url'], 20_000)
  if (result.code !== 0 || result.out.trim() !== 'http://127.0.0.1:9342') throw new Error('The Pro browser tunnel did not open.')
  return result.out.trim()
}

async function instagramOnly(page: Page) {
  const destinations = page.getByRole('combobox')
  await destinations.click()
  const options = page.getByRole('listbox').getByRole('option')
  const instagram = options.filter({ hasText: /^baeventos\.app$/ })
  const facebook = options.filter({ hasText: /^BA Eventos$/ })
  if (await instagram.getAttribute('aria-selected') !== 'true') await instagram.click()
  if (await facebook.getAttribute('aria-selected') === 'true') await facebook.click()
  const selected = await page.getByRole('listbox').getByRole('option', { selected: true }).allTextContents()
  if (selected.length !== 1 || selected[0]?.trim() !== ACCOUNT) throw new Error('Instagram must be the only destination.')
  await destinations.click()
  await verifyDestination(page)
}

async function verifyDestination(page: Page) {
  const choice = page.getByRole('combobox')
  await choice.getByText(ACCOUNT, { exact: true }).waitFor()
  if (await choice.getByAltText('Facebook').count()) throw new Error('Facebook is still selected.')
  await page.getByRole('button', { name: 'Share now', exact: true, pressed: true }).waitFor()
}

function mediaRows(page: Page) {
  return page.getByRole('option').filter({ has: button(page, 'Remove') })
}

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>
const centerOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('The sticker or its editor has no position.')
  return box
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  try {
    await page.mouse.move(to.x, to.y, { steps: 12 })
    // Meta coalesces the drag events; let it process the final movement before releasing.
    await page.waitForTimeout(150)
  } finally { await page.mouse.up() }
  await page.waitForTimeout(150)
}

async function placeSticker(page: Page, sticker: Locator, centerY: number, left?: number) {
  const stage = await boxOf(sticker.locator('xpath=../..'))
  const px = stage.height / 1920
  for (let attempt = 0; attempt < 2; attempt++) {
    const box = await boxOf(sticker)
    const from = centerOf(box)
    const to = { x: left === undefined ? from.x : centerOf(stage).x + (left - 540) * px + box.width / 2, y: stage.y + centerY * px }
    await drag(page, from, to)
    const moved = await sticker.boundingBox()
    if (moved && Math.abs(centerOf(moved).y - to.y) <= 32 * px && Math.abs(centerOf(moved).x - to.x) <= 32 * px) return
  }
  throw new Error('The sticker did not move into its intended area.')
}

async function addLink(page: Page, editor: Locator, frame: StickerFrame) {
  await button(editor, 'More stickers').click()
  // The frame-level Add link button adds a Facebook-only swipe-up. The sticker is in the photo editor.
  await editor.getByText('Link', { exact: true }).click()
  const url = page.getByRole('textbox', { name: 'Link', exact: true })
  await url.fill(frame.url)
  const custom = page.getByRole('textbox', { name: /Custom sticker text/ })
  if (await custom.isVisible()) await custom.fill(frame.text)
  await button(page, 'Apply').last().click()
  await url.waitFor({ state: 'hidden' })

  // The drag can deselect the sticker and remove its handles, so anchor on its text.
  await placeSticker(page, editor.getByText(/^🔗\s/).locator('xpath=..'), frame.centerY)
}

async function chooseMention(page: Page, editor: Locator, username: string) {
  await button(editor, 'Mention').click()
  const search = editor.getByRole('combobox', { name: 'Search for name', exact: true })
  await search.fill(username)
  const listboxId = await search.getAttribute('aria-controls')
  if (!listboxId) throw new Error('The mention search has no results control.')
  const options = page.locator(`[id=${JSON.stringify(listboxId)}]`).getByRole('option')
  const until = Date.now() + MENTION_LOOKUP_MS
  do {
    const index = exactMentionOption(await options.allInnerTexts(), username)
    if (index !== undefined) {
      const option = await options.nth(index).elementHandle({ timeout: 500 })
      if (option) {
        try {
          // The live list can reorder. Check the exact element again before using it.
          if (exactMentionOption([await option.innerText()], username) !== undefined) {
            await option.click()
            return true
          }
        } finally { await option.dispose() }
      }
    }
    await page.waitForTimeout(150)
  } while (Date.now() < until)
  await search.fill('')
  return false
}

async function addMention(page: Page, editor: Locator, username: string) {
  if (!await chooseMention(page, editor, username)) return false
  // Only accept our exact username back from the editor, then shrink its visible pill.
  const sticker = editor.getByText(new RegExp(`^@\\s*${RegExp.escape(username)}$`, 'i')).locator('xpath=../..')
  const stage = await boxOf(sticker.locator('xpath=../..'))
  const box = await boxOf(sticker)
  const scale = 76 * stage.height / 1920 / box.height
  if (scale < 1) {
    const grip = centerOf(await boxOf(sticker.getByRole('button', { name: 'resize', exact: true })))
    await drag(page, grip, { x: grip.x - box.width * (1 - scale), y: grip.y + box.height * (1 - scale) / 2 })
  }
  if ((await boxOf(sticker)).height > 90 * stage.height / 1920) throw new Error('The mention sticker could not be made small enough.')
  await placeSticker(page, sticker, 1618, 66)
  return true
}

async function capturePreviews(page: Page, dir: string, count: number) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  let previous = ''
  for (let index = 0; index < count; index++) {
    const row = mediaRows(page).nth(index)
    await row.locator('img').first().click()
    const loaded = await page.waitForFunction(({ selector, previous }) => {
      const image = document.querySelector<HTMLImageElement>(selector)
      return image?.complete && image.naturalHeight > 0 && image.src !== previous && image.src
    }, { selector: PREVIEW_IMAGE, previous }, { timeout: STEP_MS })
    previous = await loaded.jsonValue() as string
    await loaded.dispose()
    await page.locator(PREVIEW_IMAGE).locator('xpath=../..').screenshot({ path: join(dir, `frame-${index + 1}.png`) })
  }
}

async function discard(page: Page) {
  const editorCancel = button(photoEditor(page), 'Cancel')
  await page.keyboard.press('Escape')
  if (await editorCancel.isVisible()) await editorCancel.click({ timeout: 2_000 })
  await button(page, 'Cancel').click({ timeout: 2_000 })
  await button(page, 'Discard changes').click({ timeout: 2_000 })
}

/** Only this tab is closed; Browser.close on a CDP connection disconnects without quitting Chrome. */
export const composeStory: ComposeStory = async (frames, action) => {
  let browser: Browser | undefined
  let page: Page | undefined
  let editing = false
  let shareAttempted = false
  let step = 'reach the Pro agent browser'
  const cap = AbortSignal.timeout(FLOW_MS)
  const close = async () => {
    // Give Chrome a chance to close our tab before we close the transport, even when Chrome stops responding.
    await Promise.race([page?.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2_000).unref())])
    await browser?.close().catch(() => {})
  }
  const expire = () => { void close() }
  cap.addEventListener('abort', expire, { once: true })
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.connectOverCDP(await endpoint(), { timeout: STEP_MS })
    const context = browser.contexts()[0]!
    page = await context.newPage()
    page.setDefaultTimeout(STEP_MS)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    step = 'open the Business Suite story composer'
    await page.goto(COMPOSER_URL.href, { waitUntil: 'domcontentloaded', timeout: STEP_MS })
    const upload = button(page, 'Add photo/video')
    await upload.or(text(page, SIGN_IN_TEXT)).first().waitFor()
    if (needsFacebookSignIn(page.url()) || await text(page, SIGN_IN_TEXT).isVisible()) throw new StoryComposerError(step, true)
    step = 'select only Instagram and Share now'
    editing = true
    await instagramOnly(page)
    step = 'upload the Story frames to Business Suite'
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), upload.click()])
    await chooser.setFiles(frames.map(({ path }, index) => ({ name: `frame-${index + 1}.jpg`, mimeType: 'image/jpeg', buffer: readFileSync(path) })))
    await button(mediaRows(page).nth(frames.length - 1), 'Edit').waitFor()
    if (await mediaRows(page).count() !== frames.length) throw new Error('Business Suite received the wrong number of frames.')
    const skippedMentions: string[] = []
    for (const [index, frame] of frames.entries()) {
      step = `add the link sticker to frame ${index + 1} in Business Suite`
      const edit = button(mediaRows(page).nth(index), 'Edit')
      await edit.click()
      const editor = photoEditor(page)
      await addLink(page, editor, frame)
      if (frame.mention) {
        step = `add the mention sticker to frame ${index + 1} in Business Suite`
        if (!await addMention(page, editor, frame.mention)) skippedMentions.push(frame.mention)
      }
      await button(editor, 'Apply').click()
      await editor.waitFor({ state: 'hidden' })
      await edit.waitFor()
    }
    step = 'verify Instagram is the only destination and Share now is selected'
    await verifyDestination(page)
    if ('previewDir' in action) {
      step = 'capture the Instagram preview for every frame'
      await capturePreviews(page, action.previewDir, frames.length)
      step = 'discard the dry-run composer'
      await discard(page)
      editing = false
      return skippedMentions
    }
    step = 'get Business Suite ready to share the Instagram Story'
    const share = button(page, 'Share')
    await share.click({ trial: true })
    cap.throwIfAborted()
    // Errors from the job's approval, catalog, or state checks are not browser errors.
    step = ''
    await action.beforeShare(cap, skippedMentions)
    shareAttempted = true
    step = 'share the Instagram Story in Business Suite'
    cap.throwIfAborted()
    await share.click()
    // Keep the tab alive while Meta's asynchronous request runs. A click returning is not an acknowledgement.
    await page.waitForURL(url => url.pathname !== COMPOSER_URL.pathname, { timeout: 30_000 }).catch(() => {})
    return skippedMentions
  } catch (error) {
    if (!step || error instanceof StoryComposerError) throw error
    const message = error instanceof Error ? error.message : String(error)
    const signIn = needsFacebookSignIn(page?.url() ?? '', message)
      || (page && !cap.aborted && await text(page, SIGN_IN_TEXT).isVisible().catch(() => false))
    throw new StoryComposerError(cap.aborted ? 'finish the Business Suite flow within six minutes' : step, signIn)
  } finally {
    try {
      if (page && editing && !shareAttempted && !cap.aborted) await discard(page).catch(() => {})
    } finally {
      cap.removeEventListener('abort', expire)
      await close()
    }
  }
}
