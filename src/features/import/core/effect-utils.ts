import { Data, Effect } from 'effect'

/**
 * Expected failure for an import-side effect.  The operation name is kept
 * separate from the vendor error so callers can retain the existing
 * source-specific fallback while still keeping failures in Effect's error
 * channel until a Trigger or script boundary.
 */
export class ImportOperationError extends Data.TaggedError('ImportOperationError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Adapt one direct SDK/platform operation into the import graph.
 * Application orchestration composes these small effects; it does not wrap a
 * complete import workflow in one tryPromise.
 */
export function importTry<A>(operation: string, run: () => PromiseLike<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ImportOperationError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    }),
  })
}

export function importVoid(operation: string, run: () => PromiseLike<unknown>) {
  return importTry(operation, run).pipe(Effect.asVoid)
}
