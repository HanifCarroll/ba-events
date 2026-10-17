/** Common Cache API surface used by browsers, Workers and deterministic test doubles. */
export type PublicCache = Pick<Cache, 'match' | 'put'>
