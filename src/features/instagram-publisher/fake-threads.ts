import { ThreadsError, type ThreadsApi, type ThreadsPost } from './threads-api.ts'

/** A fake account with the same reads and writes the job runs against live Threads. */
export class FakeThreads implements ThreadsApi {
  calls: string[] = []
  containers = new Map<string, string>()
  posts: ThreadsPost[] = []
  clock = Date.parse('2026-11-19T15:00:00.000Z')
  containerStatus = 'FINISHED'
  publishFault: 'before' | 'after' | 'rejected' | null = null
  atLimit = false
  permalinkUnavailable = false
  next = 1

  async create(text: string) {
    this.calls.push('create')
    const id = `c${this.next++}`
    this.containers.set(id, text)
    return id
  }

  async status(id: string) {
    this.calls.push(`status ${id}`)
    if (!this.containers.has(id)) throw new Error(`Unknown container ${id}`)
    return this.containerStatus
  }

  async checkLimit() {
    this.calls.push('limit')
    if (this.atLimit) throw new ThreadsError('límite de publicación alcanzado')
  }

  post(text: string, at = this.clock + 1_000) {
    const id = `m${this.next++}`
    this.posts.unshift({ id, text, timestamp: new Date(at).toISOString(), permalink: `https://www.threads.com/@baeventos.app/post/${id}` })
    return id
  }

  async publish(id: string) {
    this.calls.push(`publish ${id}`)
    if (this.publishFault === 'before') throw new ThreadsError('publicar: sin respuesta')
    if (this.publishFault === 'rejected') throw new ThreadsError('publicar: HTTP 429', true)
    const mediaId = this.post(this.containers.get(id)!)
    if (this.publishFault === 'after') throw new ThreadsError('publicar: sin respuesta')
    return mediaId
  }

  async recent() { this.calls.push('recent'); return this.posts }

  async permalink(id: string) {
    this.calls.push(`permalink ${id}`)
    if (this.permalinkUnavailable) throw new ThreadsError('consultar el enlace: sin respuesta')
    return this.posts.find(post => post.id === id)!.permalink!
  }

  async mediaInsights(id: string) {
    this.calls.push(`insights ${id}`)
    return [{ name: 'views', values: [{ value: 100 }] }, { name: 'likes', total_value: { value: 2 } }, { name: 'link_clicks', value: 3 }]
  }

  async accountInsights() {
    this.calls.push('account insights')
    return [{ name: 'followers_count', values: [{ value: 30 }, { value: 31 }] }]
  }
}
