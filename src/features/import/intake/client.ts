/**
 * The operator CLI's HTTP client for the intake API on `baeventos-jobs` (src/jobs-worker/intake-api.ts), used when
 * `INTAKE_API_URL` and `INTAKE_API_TOKEN` are set. `remoteCollection` is the collection store over that API, so `collect`
 * keeps its Apify calls (the Mac's CLI login) and image downloads on the Mac and sends only rows and image bytes.
 */
import { Effect } from 'effect'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import type { CollectionStore, IntakePolicy, Reservation, UnreviewedMedia } from './store.ts'

export type IntakeApi = {
  /** POST /intake/<operation> with a JSON body; resolves to the JSON answer, rejects with the API's error message. */
  call<T = unknown>(operation: string, body?: unknown): Promise<T>
  putMedia(observationId: string, position: number, bytes: Uint8Array): Promise<{ object_key: string }>
  getMedia(objectKey: string): Promise<Uint8Array>
}

export function intakeApi(baseUrl: string, token: string, fetcher: typeof fetch = fetch): IntakeApi {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('INTAKE_API_URL must use https')
  const url = (path: string) => new URL(`/intake/${path}`, base)
  const auth = { authorization: `Bearer ${token}` }
  const answer = async (response: Response) => {
    const text = await response.text()
    const body = text ? JSON.parse(text) as unknown : null
    if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? `Intake API answered ${response.status}`)
    return body
  }
  return {
    call: async <T>(operation: string, body: unknown = {}) => await answer(await fetcher(url(operation), { method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) })) as T,
    putMedia: async (observationId, position, bytes) => {
      const target = url('collection/media')
      target.search = new URLSearchParams({ observation_id: observationId, position: String(position) }).toString()
      return await answer(await fetcher(target, { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' },
        body: bytes as Uint8Array<ArrayBuffer>, signal: AbortSignal.timeout(120_000) })) as { object_key: string }
    },
    getMedia: async objectKey => {
      const response = await fetcher(url(`media/${objectKey}`), { headers: auth, signal: AbortSignal.timeout(120_000) })
      if (!response.ok) await answer(response)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

const op = <A>(operation: string, run: () => Promise<A>) => importTry(operation, run).pipe(
  Effect.mapError(error => new ImportOperationError({ operation, message: error.message })))

export function remoteCollection(api: IntakeApi): CollectionStore {
  return {
    policy: () => op('intake.policy', () => api.call<IntakePolicy>('collection/policy')),
    reserveCollection: () => op('intake.reserve', () => api.call<Reservation>('collection/reserve')),
    updateRun: (id, patch) => op(`intake.${patch.state}`, () => api.call('collection/run', { id, patch })).pipe(Effect.asVoid),
    latestObservation: postId => op('intake.latest', () => api.call<{ id: string; content_hash: string } | null>('collection/latest', { post_id: postId })),
    touchObservation: id => op('intake.seen', () => api.call('collection/seen', { id })).pipe(Effect.asVoid),
    upsertObservation: row => op('intake.observe', () => api.call<{ id: string }>('collection/observe', row)),
    mediaPositions: id => op('intake.saved-media', () => api.call<number[]>('collection/positions', { id })),
    retainImage: (observationId, position, image) => op('intake.store-image', () => api.putMedia(observationId, position, image.bytes)).pipe(
      Effect.flatMap(stored => stored.object_key === image.object_key ? Effect.void
        : Effect.fail(new ImportOperationError({ operation: 'intake.store-image', message: 'Stored image hash differs from the download' })))),
    unreviewedMedia: () => op('intake.missing-media', () => api.call<UnreviewedMedia[]>('collection/missing-media')),
  }
}
