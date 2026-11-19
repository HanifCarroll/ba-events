import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const STEP_MS = 12_000
const PRO_TUNNEL = 'http://127.0.0.1:9342'

/** The SSH master can outlive its helper; no inherited stream can delay this wait. */
export function runTunnelHelper(argv: string[], timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('The Pro browser tunnel timed out.'))
    }, timeoutMs)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error('The Pro browser tunnel did not open.'))
    })
  })
}

export async function storyBrowserEndpoint(): Promise<string> {
  if (process.env.BA_INSTAGRAM_STICKERS_CDP) return process.env.BA_INSTAGRAM_STICKERS_CDP
  if (process.platform === 'darwin') return 'http://127.0.0.1:9333'
  await runTunnelHelper([join(homedir(), '.agents/skills/remote-desktop/scripts/rbrowser'), 'pro', 'url'])
  return PRO_TUNNEL
}

type Handler = { resolve(value: unknown): void; reject(error: Error): void }
type Message = { id?: number; method?: string; result?: unknown; params?: unknown; error?: { message: string } }
type Evaluation = { result: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text: string } }

/** A single socket: the browser root for target lifecycle, or one owned tab for page commands. */
export class StoryCDP {
  private nextId = 0
  private readonly pending = new Map<number, Handler>()
  private readonly events = new Map<string, Handler>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data) as Message
      const waiter = message.id ? this.pending.get(message.id) : this.events.get(message.method ?? '')
      if (message.error) waiter?.reject(new Error(message.error.message))
      else waiter?.resolve(message.result ?? message.params)
    })
    const fail = () => {
      for (const waiter of [...this.pending.values(), ...this.events.values()]) waiter.reject(new Error('The Pro browser connection closed.'))
    }
    socket.addEventListener('close', fail)
    socket.addEventListener('error', fail)
  }

  static connect(url: string): Promise<StoryCDP> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('The Pro browser connection timed out.'))
      }, STEP_MS)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(new StoryCDP(socket)) }, { once: true })
      const failed = () => { clearTimeout(timer); reject(new Error('Could not connect to the Pro browser.')) }
      socket.addEventListener('error', failed, { once: true })
      socket.addEventListener('close', failed, { once: true })
    })
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The Pro browser connection closed.'))
    const id = ++this.nextId
    const result = this.wait<number, T>(this.pending, id, method)
    try { this.socket.send(JSON.stringify({ id, method, params })) } catch (error) {
      this.pending.get(id)?.reject(error instanceof Error ? error : new Error('Could not send a browser command.'))
    }
    return result
  }

  event<T>(method: string): Promise<T> { return this.wait<string, T>(this.events, method, method) }

  private wait<K, T>(map: Map<K, Handler>, key: K, method: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    return new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${method} timed out.`)), STEP_MS)
      map.set(key, { resolve: value => resolve(value as T), reject })
    }).finally(() => {
      clearTimeout(timer)
      map.delete(key)
    })
  }

  close() { this.socket.close() }

  evaluate<Args extends unknown[], T>(fn: (...args: Args) => T, ...args: Args): Promise<Awaited<T>> {
    return this.evaluateExpression(`(${fn})(...${JSON.stringify(args)})`)
  }

  async evaluateExpression<T>(expression: string): Promise<T> {
    const result = await this.send<Evaluation>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description?.split('\n')[0] ?? result.exceptionDetails.text)
    return result.result.value as T
  }
}

function httpBase(endpoint: string) {
  const url = new URL(endpoint)
  if (url.protocol === 'ws:') url.protocol = 'http:'
  else if (url.protocol === 'wss:') url.protocol = 'https:'
  return url
}

export async function storyBrowserRoot(endpoint: string): Promise<StoryCDP> {
  const response = await fetch(new URL('/json/version', httpBase(endpoint)), { signal: AbortSignal.timeout(STEP_MS) })
  if (!response.ok) throw new Error('Could not discover the Pro browser socket.')
  const version = await response.json() as { webSocketDebuggerUrl?: string }
  if (!version.webSocketDebuggerUrl) throw new Error('The Pro browser did not report a socket.')
  return StoryCDP.connect(version.webSocketDebuggerUrl)
}

export async function openStoryTab(endpoint: () => Promise<string> = storyBrowserEndpoint) {
  const address = await endpoint()
  const root = await storyBrowserRoot(address)
  // The marker lets us recover our target if the tunnel drops before Chrome returns its ID.
  const marker = `about:blank#instagram-story-${randomUUID()}`
  let targetId: string | undefined
  let tab: StoryCDP | undefined
  const closeOn = async (base: string) => {
    const root = await storyBrowserRoot(base)
    try {
      if (!targetId) {
        const { targetInfos } = await root.send<{ targetInfos: { url: string; targetId: string }[] }>('Target.getTargets')
        targetId = targetInfos.find(target => target.url === marker)?.targetId
        if (!targetId) return
      }
      const { success } = await root.send<{ success: boolean }>('Target.closeTarget', { targetId })
      if (!success) throw new Error('The Pro browser did not close the composer.')
    } catch (error) {
      if (!(error instanceof Error && /No target with given id/i.test(error.message))) throw error
    } finally { root.close() }
  }
  const close = async () => {
    tab?.close()
    // Use a fresh browser connection so a dead page socket cannot leave a tab behind.
    try { await closeOn(address) } catch {
      try { await closeOn(await endpoint()) }
      catch { console.warn(`Could not close the Instagram Story composer tab ${targetId ?? marker} on the Pro.`) }
    }
  }
  try {
    try { ({ targetId } = await root.send<{ targetId: string }>('Target.createTarget', { url: marker, background: true })) }
    finally { root.close() }
    const url = new URL(`/devtools/page/${targetId}`, httpBase(address))
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    tab = await StoryCDP.connect(url.href)
    return { tab, targetId, close }
  } catch (error) {
    await close()
    throw error
  }
}
