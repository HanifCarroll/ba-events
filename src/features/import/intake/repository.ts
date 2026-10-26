import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'

/** One direct Supabase leaf. A failed read must never become an empty catalog. */
export function dbEffect<T extends { data: unknown; error: { message: string } | null }>(operation: string, query: () => PromiseLike<T>) {
  return importTry(operation, query).pipe(Effect.flatMap(result => result.error
    ? Effect.fail(new ImportOperationError({ operation, message: result.error.message }))
    : result.data === null ? Effect.fail(new ImportOperationError({ operation, message: 'Database returned no result' }))
    : Effect.succeed(result.data as NonNullable<T['data']>)))
}

export const allRowsEffect = Effect.fn('intake.allRows')(function*(
  client: SupabaseClient, table: string, select: string,
  filter: (query: ReturnType<ReturnType<SupabaseClient['from']>['select']>) => ReturnType<ReturnType<SupabaseClient['from']>['select']> = query => query,
) {
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; offset < 10000; offset += 500) {
    const batch = yield* dbEffect('intake.read', () => filter(client.from(table).select(select)).range(offset, offset + 499))
    rows.push(...(batch as unknown as Record<string, unknown>[]))
    if (batch.length < 500) return rows
  }
  return yield* new ImportOperationError({ operation: 'intake.read', message: 'Read limit exceeded; cannot claim a complete result' })
})
