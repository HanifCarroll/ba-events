const GRAPH = 'https://graph.threads.net'
export const THREADS_ACCOUNT = 'baeventos.app'
export const THREADS_REFRESH = `${GRAPH}/refresh_access_token`

/** Only safe, local diagnostics. An unconfirmed publish is never retried as a write. */
export class ThreadsError extends Error {
  constructor(reason: string, readonly definitive = false) { super(reason) }
}

export interface ThreadsPost { id: string; text?: string; timestamp?: string; permalink?: string }
export interface ThreadsMetric {
  name: string
  value?: number
  total_value?: { value?: number }
  values?: Array<{ value?: number; end_time?: string }>
}

export interface ThreadsApi {
  create(text: string): Promise<string>
  status(containerId: string): Promise<string>
  checkLimit(): Promise<void>
  publish(containerId: string): Promise<string>
  recent(): Promise<ThreadsPost[]>
  permalink(mediaId: string): Promise<string>
  mediaInsights(mediaId: string): Promise<ThreadsMetric[]>
  accountInsights(): Promise<ThreadsMetric[]>
}

const validThreadsPermalink = (value: unknown): value is string =>
  typeof value === 'string' && /^https:\/\/(?:www\.)?threads\.(?:net|com)\/[^\s<>]+$/i.test(value)

export async function threadsApi(token: string, fetchImpl: typeof fetch = fetch): Promise<ThreadsApi> {
  async function request<T>(path: string, operation: string, params: Record<string, string>, write = false): Promise<T> {
    const url = new URL(`${GRAPH}/v1.0/${path}`)
    const data = new URLSearchParams(params)
    if (!write) url.search = data.toString()
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: write ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` }, body: write ? data : undefined,
        redirect: 'error', signal: AbortSignal.timeout(operation === 'estado del contenedor' ? 10_000 : 30_000),
      })
    } catch {
      throw new ThreadsError(`${operation}: sin respuesta`)
    }
    const body = await response.json().catch(() => null) as (T & { error?: { code?: number; is_transient?: boolean } }) | null
    if (!response.ok || body?.error) {
      const rejected = [400, 401, 403, 429].includes(response.status) && typeof body?.error?.code === 'number' && !body.error.is_transient
      throw new ThreadsError(`${operation}: HTTP ${response.status}`, rejected)
    }
    if (!body) throw new ThreadsError(`${operation}: respuesta inválida`)
    return body
  }

  const account = await request<{ id?: string; username?: string }>('me', 'verificar la cuenta', { fields: 'id,username' })
  if (account.username !== THREADS_ACCOUNT || typeof account.id !== 'string' || !account.id) throw new ThreadsError('la cuenta no es @baeventos.app')
  const user = encodeURIComponent(account.id)
  const requireId = (body: { id?: string }) => {
    if (typeof body.id !== 'string' || !body.id) throw new ThreadsError('la API no devolvió un identificador')
    return body.id
  }
  const rows = <T>(body: { data?: T[] }): T[] => {
    if (!Array.isArray(body.data)) throw new ThreadsError('respuesta inválida de la API')
    return body.data
  }
  return {
    create: async text => requireId(await request(`${user}/threads`, 'crear contenedor', {
      media_type: 'TEXT', text, topic_tag: 'Buenos Aires', link_attachment: 'https://baeventos.com',
    }, true)),
    status: async id => (await request<{ status: string }>(encodeURIComponent(id), 'estado del contenedor', { fields: 'status,error_message' })).status,
    checkLimit: async () => {
      const body = await request<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>('me/threads_publishing_limit', 'consultar límite', { fields: 'quota_usage,config' })
      const usage = body.data?.[0]?.quota_usage
      const limit = body.data?.[0]?.config?.quota_total
      if (typeof usage !== 'number' || typeof limit !== 'number') throw new ThreadsError('no se pudo comprobar el límite de publicación')
      if (usage >= limit) throw new ThreadsError('límite de publicación alcanzado')
    },
    publish: async id => requireId(await request(`${user}/threads_publish`, 'publicar', { creation_id: id }, true)),
    recent: async () => rows<ThreadsPost>(await request('me/threads', 'buscar la publicación', { fields: 'id,text,permalink,timestamp', limit: '50' })),
    permalink: async id => {
      const { permalink } = await request<{ permalink?: string }>(encodeURIComponent(id), 'consultar el enlace', { fields: 'permalink' })
      if (!validThreadsPermalink(permalink)) throw new ThreadsError('la API no devolvió el enlace')
      return permalink
    },
    mediaInsights: async id => rows<ThreadsMetric>(await request(`${encodeURIComponent(id)}/insights`, 'consultar estadísticas de la publicación', { metric: 'views,likes,replies,reposts,quotes' })),
    accountInsights: async () => rows<ThreadsMetric>(await request(`${user}/threads_insights`, 'consultar estadísticas de la cuenta', { metric: 'views,followers_count' })),
  }
}
