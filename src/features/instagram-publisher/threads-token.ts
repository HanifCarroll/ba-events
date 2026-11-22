import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeJson } from './runtime.ts'
import { THREADS_REFRESH } from './threads-api.ts'

const TOKEN_FILE = process.env.BA_THREADS_TOKEN_FILE ?? join(homedir(), '.config/ba-events/threads-token.json')
const DAY = 86_400_000

interface ThreadsToken { access_token: string; account: string; obtained: string; app_id: string }

/** Read-only for reports. Never surface filesystem errors or JSON parser excerpts from the token file. */
export function readThreadsToken(file = TOKEN_FILE): ThreadsToken {
  let token: Partial<ThreadsToken> | null
  try {
    if ((statSync(file).mode & 0o777) !== 0o600) throw new Error()
    token = JSON.parse(readFileSync(file, 'utf8')) as Partial<ThreadsToken> | null
  } catch {
    throw new Error('Cannot read the Threads token file. Check that it exists, is valid JSON, and has mode 600.')
  }
  const { access_token, account, obtained, app_id } = token ?? {}
  if (typeof access_token !== 'string' || !access_token || typeof account !== 'string' || !account
    || typeof app_id !== 'string' || !app_id || typeof obtained !== 'string' || !Number.isFinite(Date.parse(obtained))) {
    throw new Error('The Threads token file needs access_token, account, app_id, and an ISO obtained date.')
  }
  return { access_token, account, obtained, app_id }
}

export interface ThreadsTokenCheck { accessToken: string | null; warning: string | null }

export async function loadThreadsToken(now: Date, fetchImpl: typeof fetch = fetch, file = TOKEN_FILE): Promise<ThreadsTokenCheck> {
  let token: ThreadsToken
  try { token = readThreadsToken(file) } catch (error) {
    return { accessToken: null, warning: (error as Error).message }
  }
  let age = now.getTime() - Date.parse(token.obtained)
  let warning: string | null = null
  if (age > 7 * DAY && age < 60 * DAY) {
    try {
      const url = new URL(THREADS_REFRESH)
      url.search = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: token.access_token }).toString()
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
      const body = await response.json() as { access_token?: unknown } | null
      if (!response.ok || typeof body?.access_token !== 'string' || !body.access_token) throw new Error()
      const next = { ...token, access_token: body.access_token, obtained: now.toISOString() }
      writeJson(file, next)
      token = next
      age = 0
    } catch {
      warning = 'Could not refresh the Threads token. Check the app and renew the token if needed.'
    }
  }
  if (age >= 50 * DAY) {
    const days = Math.max(0, Math.floor(60 - age / DAY))
    warning = [warning, `The Threads token has ${days} days left. Renew it before it expires.`].filter(Boolean).join(' ')
  }
  return { accessToken: age < 60 * DAY ? token.access_token : null, warning }
}
