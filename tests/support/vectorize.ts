import type { Vectorize, VectorizeVector } from '@cloudflare/workers-types'

/**
 * An in-memory stand-in for a Vectorize index binding: the calls the catalog makes (upsert, getByIds, deleteByIds),
 * applied at once. `failUpserts(n)` makes the next n upserts throw. Like Vectorize, getByIds and deleteByIds refuse more than 20 ids.
 */
export function fakeVectorize(): { index: Vectorize; vectors: Map<string, VectorizeVector>; failUpserts: (count: number) => void } {
	const vectors = new Map<string, VectorizeVector>()
	let failing = 0
	const limit = (ids: string[]) => { if (ids.length > 20) throw new Error(`Vectorize takes at most 20 ids, got ${ids.length}`) }
	const index = {
		async upsert(items: VectorizeVector[]) {
			if (failing > 0) { failing--; throw new Error('Vectorize unavailable (injected)') }
			for (const item of items) vectors.set(item.id, { ...item, values: [...item.values] })
			return { mutationId: 'fake' }
		},
		async getByIds(ids: string[]) {
			limit(ids)
			return ids.flatMap((id) => vectors.has(id) ? [structuredClone(vectors.get(id)!)] : [])
		},
		async deleteByIds(ids: string[]) {
			limit(ids)
			for (const id of ids) vectors.delete(id)
			return { mutationId: 'fake' }
		},
	}
	return { index: index as unknown as Vectorize, vectors, failUpserts: (count: number) => { failing = count } }
}
