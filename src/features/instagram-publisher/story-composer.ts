import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STEP_MS, openStoryTab, type StoryCDP } from './story-cdp.ts'
import { exactMentionOption, StoryComposerError, type ComposeStory, type StickerFrame } from './story-stickers.ts'

const COMPOSER_URL = new URL('https://business.facebook.com/latest/story_composer/?asset_id=1442212152312492&business_id=1500991868617721')
const ACCOUNT = 'baeventos.app'
const SIGN_IN_TEXT = 'Unable to access Meta Business Suite'
const FLOW_MS = 6 * 60_000
const MENTION_LOOKUP_MS = 5_000
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type Rule = { css: string; name?: string; pattern?: string; flags?: string; leaf?: boolean; index?: number; up?: number }
type Query = Rule[]
type Point = { x: number; y: number }
type Box = Point & { width: number; height: number }
const centerOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
const button = (name: string, scope: Query = []): Query => [...scope, { css: 'button,[role="button"]', name }]
const combo: Query = [{ css: '[role="combobox"]' }]
const destinationList: Query = [{ css: '[role="listbox"]:has([role="option"] img[alt="Instagram"])' }]
const destinationOption = (name: string): Query => [...destinationList, { css: '[role="option"]', name }]
const editor: Query = [{ css: '[role="dialog"]', name: 'Edit photo' }]
const mediaRows: Query = [{ css: '[role="option"]:has([role="button"])', pattern: '\\bRemove$' }]
const preview: Query = [{ css: 'img#instagram_story_preview_media' }]
const linkUrl: Query = [{ css: 'input[type="text"]', name: 'Link' }]
const customText: Query = [{ css: 'input[type="text"]', pattern: '^Custom sticker text' }]
const mentionInput: Query = [...editor, { css: 'input[role="combobox"][placeholder="Search for name"]' }]
const signInError: Query = [{ css: 'div,span', pattern: SIGN_IN_TEXT, leaf: true }]
const at = (query: Query, index: number): Query => [...query.slice(0, -1), { ...query.at(-1)!, index }]
const parent = (query: Query, up: number): Query => [...query.slice(0, -1), { ...query.at(-1)!, up }]
const sticker = (pattern: string, flags?: string): Query => [...editor, { css: 'div[style*="margin-left:"][style*="margin-top:"][style*="transform: rotate("]', pattern, flags }]

export function needsFacebookSignIn(url: string, message = ''): boolean {
  return /^(?:https?:\/\/(?:[^./]+\.)*facebook\.com)(?::\d+)?\/(?:login(?:\.php)?|checkpoint|auth_platform)(?:[/?#]|$)/i.test(url)
    || url.startsWith('chrome-error://') || /ERR_TOO_MANY_REDIRECTS/i.test(message) || message.includes(SIGN_IN_TEXT)
}

/** Read the owned tab, optionally scrolling a control into view or focusing an input. */
function inspect(tab: StoryCDP, rules: Query, action: 'read' | 'scroll' | 'clickPoint' | 'focus' = 'read') {
  return tab.evaluate((rules, action) => {
    const normalized = (text: string) => text.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
    const name = (node: HTMLElement) => {
      const ref = node.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.innerText).join(' ')
      return normalized(ref || node.getAttribute('aria-label') || node.innerText || '')
    }
    let roots: ParentNode[] = [document]
    let nodes: HTMLElement[] = []
    for (const rule of rules) {
      const pattern = rule.pattern && new RegExp(rule.pattern, rule.flags)
      nodes = roots.flatMap(root => [...root.querySelectorAll<HTMLElement>(rule.css)]).filter(node => {
        if (!node.getClientRects().length || getComputedStyle(node).visibility === 'hidden') return false
        const label = name(node)
        return (rule.name === undefined || label === rule.name) && (!pattern || pattern.test(label))
      })
      if (rule.leaf) nodes = nodes.filter(node => !nodes.some(other => other !== node && node.contains(other)))
      if (rule.index !== undefined) nodes = nodes.slice(rule.index === -1 ? -1 : rule.index, rule.index === -1 ? undefined : rule.index + 1)
      for (let up = 0; up < (rule.up ?? 0); up++) nodes = nodes.flatMap(node => node.parentElement ? [node.parentElement] : [])
      roots = nodes
    }
    const one = nodes.length === 1 ? nodes[0] : undefined
    if (one && (action === 'scroll' || action === 'clickPoint')) one.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    if (one && action === 'focus' && one instanceof HTMLInputElement) { one.focus(); one.select() }
    return nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect()
      const hit = action === 'clickPoint' && document.elementFromPoint(x + width / 2, y + height / 2)
      return {
        text: node.innerText, name: name(node), box: { x, y, width, height },
        docBox: { x: x + scrollX, y: y + scrollY, width, height },
        clicked: Boolean(hit && node.contains(hit) && node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('disabled')),
        focused: action === 'focus' && document.activeElement === node,
        selected: node.getAttribute('aria-selected') === 'true', pressed: node.getAttribute('aria-pressed') === 'true',
        controls: node.getAttribute('aria-controls'),
        facebook: Boolean(node.querySelector('img[alt="Facebook"]')),
        src: node instanceof HTMLImageElement && node.complete && node.naturalHeight > 0 ? node.src : '',
      }
    })
  }, rules, action)
}

const single = <T>(items: T[]): T | undefined => items.length === 1 ? items[0] : undefined

async function until<T>(read: () => Promise<T | undefined | false>, ms = STEP_MS, interval = 100): Promise<T> {
  const end = Date.now() + ms
  do {
    const result = await read()
    if (result !== undefined && result !== false) return result
    await delay(interval)
  } while (Date.now() < end)
  throw new Error('Business Suite did not show the expected control.')
}

const visible = async (tab: StoryCDP, query: Query) => (await inspect(tab, query)).length > 0
const one = (tab: StoryCDP, query: Query) => until(async () => single(await inspect(tab, query)))
const boxOf = async (tab: StoryCDP, query: Query) => (await one(tab, query)).box
const hit = async (tab: StoryCDP, query: Query) => {
  const target = single(await inspect(tab, query, 'clickPoint'))
  return target?.clicked ? target : undefined
}

const mouse = (tab: StoryCDP, type: string, point: Point, buttons = 0) => tab.send('Input.dispatchMouseEvent', {
  type, ...point, buttons,
  button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
  ...(type === 'mouseMoved' ? {} : { clickCount: 1 }),
  force: buttons ? 0.5 : 0,
})
async function clickPoint(tab: StoryCDP, point: Point) {
  await Promise.all([mouse(tab, 'mouseMoved', point), mouse(tab, 'mousePressed', point, 1), mouse(tab, 'mouseReleased', point)])
}
async function click(tab: StoryCDP, query: Query, timeout?: number) {
  await clickPoint(tab, centerOf((await until(() => hit(tab, query), timeout)).box))
}
async function key(tab: StoryCDP, name: string, code: number) {
  for (const type of ['keyDown', 'keyUp']) await tab.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code })
}
async function fill(tab: StoryCDP, query: Query, value: string) {
  const input = await until(async () => single(await inspect(tab, query, 'focus')) || undefined)
  if (!input.focused) throw new Error('The composer input did not get focus.')
  if (value) await tab.send('Input.insertText', { text: value })
  else await key(tab, 'Backspace', 8)
}

async function verifyDestination(tab: StoryCDP) {
  await until(async () => {
    const destination = single(await inspect(tab, combo))
    const now = single(await inspect(tab, button('Share now')))
    return destination?.text.replace(/\u200b/g, '').trim() === ACCOUNT && !destination.facebook && now?.pressed
  })
}

async function instagramOnly(tab: StoryCDP) {
  await click(tab, combo)
  if (!(await one(tab, destinationOption(ACCOUNT))).selected) await click(tab, destinationOption(ACCOUNT))
  if ((await one(tab, destinationOption('BA Eventos'))).selected) await click(tab, destinationOption('BA Eventos'))
  await until(async () => single(await inspect(tab, [...destinationList, { css: '[role="option"][aria-selected="true"]' }]))?.name === ACCOUNT)
  await click(tab, combo)
  await verifyDestination(tab)
}

async function upload(tab: StoryCDP, frames: StickerFrame[]) {
  await tab.send('Page.enable')
  await tab.send('Page.setInterceptFileChooserDialog', { enabled: true })
  const [{ backendNodeId, frameId }] = await Promise.all([
    tab.event<{ backendNodeId?: number; frameId: string }>('Page.fileChooserOpened'), click(tab, button('Add photo/video')),
  ])
  if (!backendNodeId) throw new Error('The browser did not report the chooser input.')
  const { executionContextId } = await tab.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId, worldName: 'instagram-publisher' })
  const { object } = await tab.send<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId, executionContextId })
  const files = frames.map(({ path }, index) => ({ name: `frame-${index + 1}.jpg`, bytes: readFileSync(path).toString('base64') }))
  const setFiles = function (this: HTMLInputElement, files: Array<{ name: string; bytes: string }>) {
    const transfer = new DataTransfer()
    for (const { name, bytes } of files) transfer.items.add(new File([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], name, { type: 'image/jpeg' }))
    this.files = transfer.files
    this.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    this.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const result = await tab.send<{ exceptionDetails?: unknown }>('Runtime.callFunctionOn', {
    objectId: object.objectId, functionDeclaration: setFiles.toString(), arguments: [{ value: files }], userGesture: true,
  })
  if (result.exceptionDetails) throw new Error('The composer did not accept the selected JPEGs.')
  await tab.send('Page.setInterceptFileChooserDialog', { enabled: false })
  await until(async () => (await inspect(tab, mediaRows)).length === frames.length)
}

async function drag(tab: StoryCDP, from: Point, to: Point) {
  await mouse(tab, 'mouseMoved', from)
  await mouse(tab, 'mousePressed', from, 1)
  try {
    for (let i = 1; i <= 12; i++) await mouse(tab, 'mouseMoved', { x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 }, 1)
    // Meta coalesces drag events; give it time to process the last movement before releasing.
    await delay(150)
  } finally { await mouse(tab, 'mouseReleased', to) }
  await delay(150)
}

async function placeSticker(tab: StoryCDP, item: Query, centerY: number, left?: number) {
  const stage = await boxOf(tab, parent(item, 2))
  const px = stage.height / 1920
  for (let attempt = 0; attempt < 2; attempt++) {
    const box = await boxOf(tab, item)
    const from = centerOf(box)
    const to = { x: left === undefined ? from.x : centerOf(stage).x + (left - 540) * px + box.width / 2, y: stage.y + centerY * px }
    await drag(tab, from, to)
    const moved = centerOf(await boxOf(tab, item))
    if (Math.abs(moved.y - to.y) <= 32 * px && Math.abs(moved.x - to.x) <= 32 * px) return
  }
  throw new Error('The sticker did not move into its intended area.')
}

async function addLink(tab: StoryCDP, frame: StickerFrame) {
  await click(tab, button('More stickers', editor))
  // The frame-level Add link button is Facebook-only; this is the Instagram sticker tile.
  await click(tab, button('Create link sticker', editor))
  await fill(tab, linkUrl, frame.url)
  if (await visible(tab, customText)) await fill(tab, customText, frame.text)
  await click(tab, at(button('Apply'), -1))
  await until(async () => !await visible(tab, linkUrl))
  await placeSticker(tab, sticker('^🔗\\s'), frame.centerY)
}

async function chooseMention(tab: StoryCDP, username: string) {
  await click(tab, button('Mention', editor))
  await fill(tab, mentionInput, username)
  const id = (await one(tab, mentionInput)).controls
  if (!id) throw new Error('The mention search has no results control.')
  // Match and select in the same browser task so the async list cannot reorder in between.
  const select = (id: string, username: string, exact: typeof exactMentionOption) => {
    const rows = [...document.getElementById(id)?.querySelectorAll<HTMLElement>('[role="option"]') ?? []]
      .filter(row => row.getClientRects().length && getComputedStyle(row).visibility !== 'hidden')
    const index = exact(rows.map(row => row.innerText), username)
    const row = index === undefined ? undefined : rows[index]
    if (!row || row.getAttribute('aria-disabled') === 'true') return false
    row.click()
    return true
  }
  const expression = `(${select})(${JSON.stringify(id)},${JSON.stringify(username)},${exactMentionOption})`
  const end = Date.now() + MENTION_LOOKUP_MS
  do {
    if (await tab.evaluateExpression<boolean>(expression)) return true
    await delay(150)
  } while (Date.now() < end)
  await fill(tab, mentionInput, '')
  return false
}

async function addMention(tab: StoryCDP, username: string) {
  if (!await chooseMention(tab, username)) return false
  const item = sticker(`^@\\s*${RegExp.escape(username)}$`, 'i')
  const stage = await boxOf(tab, parent(item, 2))
  const px = stage.height / 1920
  for (let attempt = 0; attempt < 2; attempt++) {
    const box = await boxOf(tab, item)
    if (box.height <= 90 * px) break
    const scale = 76 * px / box.height
    const grip = centerOf(await boxOf(tab, button('resize', item)))
    await drag(tab, grip, { x: grip.x - box.width * (1 - scale), y: grip.y + box.height * (1 - scale) / 2 })
  }
  if ((await boxOf(tab, item)).height > 90 * px) throw new Error('The mention sticker could not be made small enough.')
  await placeSticker(tab, item, 1618, 66)
  return true
}

async function capturePreviews(tab: StoryCDP, dir: string, count: number) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const instagramPreview = button('Instagram story')
  if (await visible(tab, instagramPreview)) await click(tab, instagramPreview)
  const thumbnail = (index: number): Query => [...at(mediaRows, index), { css: 'img', index: 0 }]
  // Force a selection change for the first capture even if Meta has already selected frame one.
  await click(tab, thumbnail(count - 1))
  let addedPreview = false
  if (!await until(() => visible(tab, preview), 2_000).catch(() => false)) {
    // Meta sometimes leaves the Instagram-only preview blank. Expose both preview panes in the dry run only.
    await click(tab, combo)
    await click(tab, destinationOption('BA Eventos'))
    await click(tab, combo)
    if (await visible(tab, instagramPreview)) await click(tab, instagramPreview)
    addedPreview = true
  }
  let previous = ''
  for (let index = 0; index < count; index++) {
    await click(tab, thumbnail(index))
    const loaded = await until(async () => {
      const image = single(await inspect(tab, preview))
      return image?.src && image.src !== previous ? image : undefined
    })
    previous = loaded.src
    const container = parent(preview, 2)
    await inspect(tab, container, 'scroll')
    await tab.evaluate(async () => {
      await document.querySelector<HTMLImageElement>('#instagram_story_preview_media')?.decode()
      await document.fonts.ready
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    const { docBox } = await one(tab, container)
    const { data } = await tab.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png', clip: { ...docBox, scale: 1 }, captureBeyondViewport: false,
    })
    writeFileSync(join(dir, `frame-${index + 1}.png`), Buffer.from(data, 'base64'))
  }
  if (addedPreview) await instagramOnly(tab)
}

async function discard(tab: StoryCDP) {
  await key(tab, 'Escape', 27)
  if (await visible(tab, editor)) await click(tab, button('Cancel', editor), 2_000)
  await click(tab, button('Cancel'), 2_000)
  await click(tab, button('Discard changes'), 2_000)
}

const locationOf = (tab: StoryCDP) => tab.evaluate(() => location.href)

export const composeStory: ComposeStory = async (frames, action) => {
  let owned: Awaited<ReturnType<typeof openStoryTab>> | undefined
  let editing = false
  let shareAttempted = false
  let step = 'reach the Pro agent browser'
  const cap = AbortSignal.timeout(FLOW_MS)
  const expire = () => owned?.tab.close()
  cap.addEventListener('abort', expire, { once: true })
  try {
    owned = await openStoryTab()
    const { tab } = owned
    await tab.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    step = 'open the Business Suite story composer'
    const navigation = await tab.send<{ errorText?: string }>('Page.navigate', { url: COMPOSER_URL.href })
    if (navigation.errorText) throw new Error(navigation.errorText)
    await until(async () => {
      const url = await locationOf(tab).catch(() => '')
      if (!url) return false
      if (needsFacebookSignIn(url) || await visible(tab, signInError)) throw new StoryComposerError(step, true)
      return visible(tab, button('Add photo/video'))
    })
    step = 'select only Instagram and Share now'
    editing = true
    if ('previewDir' in action && await visible(tab, button('Instagram story'))) await click(tab, button('Instagram story'))
    await instagramOnly(tab)
    step = 'upload the Story frames to Business Suite'
    await upload(tab, frames)
    const skippedMentions: string[] = []
    for (const [index, frame] of frames.entries()) {
      step = `add the link sticker to frame ${index + 1} in Business Suite`
      const edit = button('Edit', at(mediaRows, index))
      await click(tab, edit)
      await addLink(tab, frame)
      if (frame.mention) {
        step = `add the mention sticker to frame ${index + 1} in Business Suite`
        if (!await addMention(tab, frame.mention)) skippedMentions.push(frame.mention)
      }
      await click(tab, button('Apply', editor))
      await until(async () => !await visible(tab, editor))
      await one(tab, edit)
    }
    step = 'verify Instagram is the only destination and Share now is selected'
    await verifyDestination(tab)
    if ('previewDir' in action) {
      step = 'capture the Instagram preview for every frame'
      await capturePreviews(tab, action.previewDir, frames.length)
      step = 'discard the dry-run composer'
      await discard(tab)
      editing = false
      return skippedMentions
    }
    step = 'get Business Suite ready to share the Instagram Story'
    await until(() => hit(tab, button('Share')))
    cap.throwIfAborted()
    // Errors from approval, catalog, or state checks are not browser errors.
    step = ''
    await action.beforeShare(cap, skippedMentions)
    shareAttempted = true
    step = 'share the Instagram Story in Business Suite'
    cap.throwIfAborted()
    await click(tab, button('Share'))
    // Keep the tab alive while Meta handles the async request. Only Graph can confirm the result.
    await until(async () => new URL(await locationOf(tab)).pathname !== COMPOSER_URL.pathname, 30_000, 500).catch(() => {})
    return skippedMentions
  } catch (error) {
    if (!step || error instanceof StoryComposerError) throw error
    const message = error instanceof Error ? error.message : String(error)
    const tab = owned?.tab
    const signIn = needsFacebookSignIn(tab && !cap.aborted ? await locationOf(tab).catch(() => '') : '', message)
      || (tab && !cap.aborted && await visible(tab, signInError).catch(() => false))
    throw new StoryComposerError(cap.aborted ? 'finish the Business Suite flow within six minutes' : step, signIn)
  } finally {
    try {
      if (owned && editing && !shareAttempted && !cap.aborted) await discard(owned.tab).catch(() => {})
    } finally {
      cap.removeEventListener('abort', expire)
      await owned?.close()
    }
  }
}
