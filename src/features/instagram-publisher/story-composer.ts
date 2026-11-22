import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STEP_MS, openStoryTab, StoryCDPTimeout, type StoryCDP } from './story-cdp.ts'
import { saveComposerEvidence } from './story-evidence.ts'
import { exactMentionOption, retryComposerOnce, StoryComposerError, type ComposeStory, type StickerFrame } from './story-stickers.ts'

const COMPOSER_URL = new URL('https://business.facebook.com/latest/story_composer/?asset_id=1442212152312492&business_id=1500991868617721')
const ACCOUNT = 'baeventos.app'
const SIGN_IN_TEXT = 'Unable to access Meta Business Suite'
const FLOW_MS = 6 * 60_000
const COMPOSER_LOAD_MS = 30_000
const MENTION_LOOKUP_MS = 5_000
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type Rule = { css: string; name?: string; pattern?: string; flags?: string; index?: number; up?: number }
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
const at = (query: Query, index: number): Query => [...query.slice(0, -1), { ...query.at(-1)!, index }]
const parent = (query: Query, up: number): Query => [...query.slice(0, -1), { ...query.at(-1)!, up }]
const sticker = (pattern: string, flags?: string): Query => [...editor, { css: 'div[style*="margin-left:"][style*="margin-top:"][style*="transform: rotate("]', pattern, flags }]

export function needsFacebookSignIn(url: string, message = ''): boolean {
  return /^(?:https?:\/\/(?:[^./]+\.)*facebook\.com)(?::\d+)?\/(?:login(?:\.php)?|checkpoint|auth_platform)(?:[/?#]|$)/i.test(url)
    || url.startsWith('chrome-error://') || /ERR_TOO_MANY_REDIRECTS/i.test(message) || message.includes(SIGN_IN_TEXT)
}

/** Read the owned tab, optionally scrolling a control into view or focusing an input. */
function inspect(tab: StoryCDP, rules: Query, action: 'read' | 'scroll' | 'clickPoint' | 'activate' | 'focus' = 'read') {
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
      if (rule.index !== undefined) nodes = nodes.slice(rule.index === -1 ? -1 : rule.index, rule.index === -1 ? undefined : rule.index + 1)
      for (let up = 0; up < (rule.up ?? 0); up++) nodes = nodes.flatMap(node => node.parentElement ? [node.parentElement] : [])
      roots = nodes
    }
    const one = nodes.length === 1 ? nodes[0] : undefined
    const wantsHit = action === 'clickPoint' || action === 'activate'
    if (one && (action === 'scroll' || wantsHit)) one.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    if (one && action === 'focus' && one instanceof HTMLInputElement) { one.focus(); one.select() }
    return nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect()
      const hit = wantsHit && document.elementFromPoint(x + width / 2, y + height / 2)
      const clickable = Boolean(hit && node.contains(hit) && node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('disabled'))
      if (one === node && action === 'activate' && clickable) (hit instanceof HTMLElement ? hit : node).click()
      return {
        text: node.innerText, name: name(node), box: { x, y, width, height },
        docBox: { x: x + scrollX, y: y + scrollY, width, height },
        clicked: clickable,
        focused: action === 'focus' && document.activeElement === node,
        selected: node.getAttribute('aria-selected') === 'true', pressed: node.getAttribute('aria-pressed') === 'true',
        facebook: Boolean(node.querySelector('img[alt="Facebook"]')),
        src: node instanceof HTMLImageElement && node.complete && node.naturalHeight > 0 ? node.src : '',
      }
    })
  }, rules, action)
}

const single = <T>(items: T[]): T | undefined => items.length === 1 ? items[0] : undefined

async function until<T>(read: () => Promise<T | undefined | false>, ms = STEP_MS, interval = 100, expected = 'the expected control'): Promise<T> {
  const end = Date.now() + ms
  do {
    const result = await read()
    if (result !== undefined && result !== false) return result
    await delay(interval)
  } while (Date.now() < end)
  throw new Error(`Business Suite did not show ${expected}.`)
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
// React controls can move before a remote pointer click arrives. Resolve and activate editor controls in one task.
async function activate(tab: StoryCDP, query: Query, timeout?: number) {
  await until(async () => single(await inspect(tab, query, 'activate'))?.clicked, timeout, 100, query.at(-1)?.name ?? 'the expected control')
}
async function key(tab: StoryCDP, name: string, code: number) {
  for (const type of ['keyDown', 'keyUp']) await tab.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code })
}
async function fill(tab: StoryCDP, query: Query, value: string) {
  const input = await until(async () => single(await inspect(tab, query, 'focus')), STEP_MS, 100, query.at(-1)?.name ?? query.at(-1)?.pattern ?? 'the text input')
  if (!input.focused) throw new Error('The composer input did not get focus.')
  if (value) await tab.send('Input.insertText', { text: value })
  else await key(tab, 'Backspace', 8)
}

async function verifyDestination(tab: StoryCDP) {
  await until(async () => {
    const [destination, now] = (await Promise.all([inspect(tab, combo), inspect(tab, button('Share now'))])).map(single)
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
  const appendFile = function (this: HTMLInputElement, name: string, bytes: string, last: boolean) {
    const transfer = new DataTransfer()
    for (const file of this.files ?? []) transfer.items.add(file)
    transfer.items.add(new File([Uint8Array.fromBase64(bytes)], name, { type: 'image/jpeg' }))
    this.files = transfer.files
    if (last) {
      this.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
      this.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  // Send one frame per tunnel request; only the completed selection should reach Meta.
  for (const [index, { path }] of frames.entries()) {
    const values = [`frame-${index + 1}.jpg`, readFileSync(path).toString('base64'), index === frames.length - 1]
    const result = await tab.send<{ exceptionDetails?: unknown }>('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration: appendFile.toString(), arguments: values.map(value => ({ value })), userGesture: true,
    })
    if (result.exceptionDetails) throw new Error('The composer did not accept the selected JPEGs.')
  }
  await tab.send('Page.setInterceptFileChooserDialog', { enabled: false })
  await until(async () => (await inspect(tab, mediaRows)).length === frames.length)
}

async function drag(tab: StoryCDP, from: Point, to: Point) {
  await mouse(tab, 'mouseMoved', from)
  await mouse(tab, 'mousePressed', from, 1)
  try {
    // Separate the moves so Chrome doesn't coalesce a resize into a single pointer event.
    for (const progress of [0.25, 0.6, 1]) {
      await mouse(tab, 'mouseMoved', { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }, 1)
      await delay(50)
    }
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
  // Opening Edit can leave the crop panel active while the media loads. Only retry the menu click from Crop.
  const createLink = button('Create link sticker', editor)
  await until(async () => {
    if (await visible(tab, createLink)) return true
    if (await visible(tab, button('Original', editor))) await activate(tab, button('More stickers', editor))
    return false
  }, STEP_MS, 300, 'the sticker menu')
  // The link tile opens a popover; use pointer input so its outside-click handler sees the right sequence.
  await click(tab, createLink)
  await fill(tab, linkUrl, frame.url)
  if (await visible(tab, customText)) await fill(tab, customText, frame.text)
  await click(tab, at(button('Apply'), -1))
  await until(async () => !await visible(tab, linkUrl), STEP_MS, 100, 'the link form close')
  await placeSticker(tab, sticker('^🔗\\s'), frame.centerY)
}

export async function selectMentionResult(tab: Pick<StoryCDP, 'evaluateExpression'>, username: string) {
  const selector = JSON.stringify(mentionInput.map(rule => rule.css).join(' '))
  // Match and select in the same browser task so the async list cannot reorder in between.
  const select = (selector: string, username: string, exact: typeof exactMentionOption) => {
    const inputs = [...document.querySelectorAll(selector)].filter(input => input.getClientRects().length && getComputedStyle(input).visibility !== 'hidden')
    const id = inputs.length === 1 ? inputs[0]?.getAttribute('aria-controls') : null
    if (!id) return false
    const rows = [...document.getElementById(id)?.querySelectorAll<HTMLElement>('[role="option"]') ?? []]
      .filter(row => row.getClientRects().length && getComputedStyle(row).visibility !== 'hidden')
    const index = exact(rows.map(row => row.innerText), username)
    const row = index === undefined ? undefined : rows[index]
    if (!row || row.getAttribute('aria-disabled') === 'true') return false
    row.click()
    return true
  }
  const expression = `(${select})(${selector},${JSON.stringify(username)},${exactMentionOption})`
  const end = Date.now() + MENTION_LOOKUP_MS
  do {
    if (await tab.evaluateExpression<boolean>(expression)) return true
    const remaining = end - Date.now()
    if (remaining > 0) await delay(Math.min(150, remaining))
  } while (Date.now() < end)
  return false
}

async function chooseMention(tab: StoryCDP, username: string) {
  await activate(tab, button('Mention', editor))
  await fill(tab, mentionInput, username)
  if (await selectMentionResult(tab, username)) return true
  await fill(tab, mentionInput, '')
  return false
}

async function addMention(tab: StoryCDP, username: string, at: { left: number; centerY: number }) {
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
  await placeSticker(tab, item, at.centerY, at.left)
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
  if (await visible(tab, editor)) {
    await activate(tab, button('Cancel', editor))
    await until(async () => !await visible(tab, editor))
  }
  const confirm = button('Discard changes')
  // A failed cleanup may already have opened the confirmation dialog.
  if (!await visible(tab, confirm)) await activate(tab, button('Cancel'))
  await activate(tab, confirm)
  await until(async () => new URL(await locationOf(tab).catch(() => COMPOSER_URL.href)).pathname !== COMPOSER_URL.pathname)
}

const locationOf = (tab: StoryCDP) => tab.evaluate(() => location.href)
const signInErrorOnPage = (tab: StoryCDP) => tab.evaluate(text => document.body?.innerText.includes(text), SIGN_IN_TEXT)

async function composeAttempt(frames: StickerFrame[], action: Parameters<ComposeStory>[1], cap: AbortSignal) {
  let owned: Awaited<ReturnType<typeof openStoryTab>> | undefined
  let evidenceTab: StoryCDP | undefined
  let lastUrl = ''
  let editing = false
  let shareGateEntered = false
  let shareAttempted = false
  let step = 'reach the Pro agent browser'
  const expire = () => owned?.tab.close()
  cap.addEventListener('abort', expire, { once: true })
  try {
    cap.throwIfAborted()
    owned = await openStoryTab()
    cap.throwIfAborted()
    const { tab } = owned
    await tab.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    step = 'open the Business Suite story composer'
    const navigation = await tab.send<{ errorText?: string }>('Page.navigate', { url: COMPOSER_URL.href })
    if (navigation.errorText) throw new Error(navigation.errorText)
    // Navigation can finish before Meta has mounted the composer; only initial readiness gets a longer window.
    await until(async () => {
      const page = await tab.evaluate(text => ({
        url: location.href,
        signInError: document.body?.innerText.includes(text),
        ready: [...document.querySelectorAll<HTMLElement>('button,[role="button"]')].some(node =>
          (node.getAttribute('aria-label') ?? node.innerText).trim() === 'Add photo/video' && node.getClientRects().length > 0),
      }), SIGN_IN_TEXT).catch(error => {
        if (tab.connected && (error instanceof StoryCDPTimeout || error instanceof Error && /execution context/i.test(error.message))) return undefined
        throw error
      })
      if (!page) return false
      lastUrl = page.url
      if (needsFacebookSignIn(page.url) || page.signInError) throw new StoryComposerError(step, true)
      return page.ready
    }, COMPOSER_LOAD_MS, 250, 'the Story composer')
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
      await activate(tab, edit)
      await addLink(tab, frame)
      if (frame.mention) {
        step = `add the mention sticker to frame ${index + 1} in Business Suite`
        if (!await addMention(tab, frame.mention, frame.mentionAt!)) skippedMentions.push(frame.mention)
      }
      await activate(tab, button('Apply', editor))
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
    shareGateEntered = true
    await action.beforeShare(cap, skippedMentions)
    shareAttempted = true
    step = 'share the Instagram Story in Business Suite'
    cap.throwIfAborted()
    await click(tab, button('Share'))
    step = 'read the Business Suite Share result'
    // Keep the tab alive while Meta handles the async request. Only Graph can confirm the result.
    await until(async () => new URL(await locationOf(tab)).pathname !== COMPOSER_URL.pathname, 30_000, 500, 'the composer close after Share')
    return skippedMentions
  } catch (error) {
    const known = error instanceof StoryComposerError ? error : undefined
    if (!step && !known) throw error
    const message = error instanceof Error ? error.message : String(error)
    const failedStep = known?.step ?? (cap.aborted ? 'finish the Business Suite flow within six minutes' : step)
    const commandTimedOut = error instanceof StoryCDPTimeout
    // A stalled socket can report OPEN while neither a URL read nor a screenshot comes back.
    if (owned && (commandTimedOut || !owned.tab.connected)) evidenceTab = await owned.reconnect().catch(() => undefined)
    const tab = evidenceTab ?? owned?.tab
    const [url, image, signInErrorVisible] = await Promise.all([
      tab ? locationOf(tab).catch(() => '') : '',
      tab?.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 65 }).catch(() => undefined),
      tab && !known && !cap.aborted && signInErrorOnPage(tab).catch(() => false),
    ])
    const root = 'previewDir' in action ? action.previewDir : action.evidenceDir
    let evidenceDir: string | undefined
    try { evidenceDir = saveComposerEvidence(root, failedStep, url || lastUrl, message, image?.data) }
    catch { console.warn(`Could not save composer failure evidence in ${root}.`) }
    const signIn = known?.signIn || needsFacebookSignIn(url || lastUrl, message) || Boolean(signInErrorVisible)
    // Never retry a flow that reached the callback which persists the Share marker.
    throw new StoryComposerError(failedStep, signIn, evidenceDir, commandTimedOut && !signIn && !shareGateEntered)
  } finally {
    try {
      if (owned && editing && !shareAttempted && !cap.aborted) await discard(evidenceTab ?? owned.tab).catch(() => {})
    } finally {
      cap.removeEventListener('abort', expire)
      evidenceTab?.close()
      await owned?.close()
    }
  }
}

export const composeStory: ComposeStory = (frames, action) => {
  const cap = AbortSignal.timeout(FLOW_MS)
  return retryComposerOnce(() => composeAttempt(frames, action, cap), cap)
}
