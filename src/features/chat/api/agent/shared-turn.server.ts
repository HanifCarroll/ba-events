import { Data, Effect } from 'effect'
import type { PinResolution } from '#shared/lib/types.ts'
import { getEventFactsByIds } from '#shared/lib/db/client.server.ts'
import {
  getSavedMembershipForIds,
  type UserToolContext,
} from '#features/chat/api/user-tools.server.ts'
import { detectResponseLanguage, MAX_USER_TEXT } from './context.ts'
import {
  collectEventIds,
  homeHintsFromIds,
  buildPriorContext,
  sanitizeText,
  type PriorContext,
  type PriorResponseHint,
} from './follow-up.ts'
import { orchestrateEffect, type OrchestrateResult } from './orchestrate.ts'
import { currentDateInBuenosAires, type LastSearchContext } from './search-context.ts'
import type { AgentHistoryMessage } from './history.ts'
import { logger } from '#shared/lib/logger.ts'
import type { ConciergeTraceContext } from '#shared/lib/ai/langfuse.server.ts'

export interface SharedChatTurnInput extends ConciergeTraceContext {
  requestId: string
  userContext: UserToolContext
  text: string
  locale: 'en' | 'es'
  priorHints: PriorResponseHint[]
  lastSearch?: LastSearchContext | null
  homeEventIds?: string[]
  pin?: PinResolution
  pinFacts?: { name: string; venueName: string | null } | null
  recentMessages?: AgentHistoryMessage[]
  onSearchStart?: () => void
  onTrustedSearchProgress?: () => void
  onProgress?: (response: import('#shared/lib/types.ts').CanonicalChatResponse) => void
  abortSignal?: AbortSignal
}

export type SharedChatTurnDependencies = {
  fetchEventFacts?: typeof getEventFactsByIds
  getSavedMembership?: typeof getSavedMembershipForIds
  orchestrateFn?: (input: Parameters<typeof orchestrateEffect>[0]) => Promise<OrchestrateResult>
  currentDateInBA?: string
}

const EMPTY_PRIOR: PriorContext = { groups: [], venueByEventId: new Map() }

class SharedChatTurnError extends Data.TaggedError('SharedChatTurnError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export function normalizeChatTurn(text: string, fallbackLocale: 'en' | 'es') {
  const originalQuery = sanitizeText(text, MAX_USER_TEXT)
  return {
    originalQuery,
    locale: detectResponseLanguage(originalQuery, fallbackLocale),
  }
}

/** Effect-native channel-neutral turn program after channel-specific parsing. */
export function runSharedChatTurnEffect(
  input: SharedChatTurnInput,
  dependencies: SharedChatTurnDependencies = {}
): Effect.Effect<OrchestrateResult, SharedChatTurnError> {
  const fetchEventFacts = dependencies.fetchEventFacts ?? getEventFactsByIds
  const getSavedMembership = dependencies.getSavedMembership ?? getSavedMembershipForIds
  return Effect.gen(function* () {
    const normalized = normalizeChatTurn(input.text, input.locale)
    const contextProgram = Effect.gen(function* () {
      const rehydrate = (hints: PriorResponseHint[]) => Effect.gen(function* () {
        const ids = collectEventIds(hints)
        const started = performance.now()
        const [membership, facts] = yield* Effect.all([
          input.userContext.isAuthenticated
            ? Effect.tryPromise({
                try: (fiberSignal) => getSavedMembership(input.userContext, ids, input.abortSignal ? AbortSignal.any([input.abortSignal, fiberSignal]) : fiberSignal),
                catch: (cause) => new SharedChatTurnError({ message: 'Failed to load saved membership', cause }),
              }).pipe(Effect.tap((membership) => Effect.sync(() => {
                logger.info('[chat] pre-agent membership stage', {
                  durationMs: Math.round(performance.now() - started),
                  requestedCount: ids.length,
                  authenticated: true,
                  resultCount: membership.status === 'complete' ? membership.savedIds.size : 0,
                })
              })))
            : Effect.succeed(undefined),
          ids.length
            ? Effect.tryPromise({
                try: (fiberSignal) => fetchEventFacts(ids, input.abortSignal ? AbortSignal.any([input.abortSignal, fiberSignal]) : fiberSignal),
                catch: (cause) => new SharedChatTurnError({ message: 'Failed to rehydrate prior context', cause }),
              })
            : Effect.succeed([]),
        ], { concurrency: 2 })
        return buildPriorContext(hints, facts, membership)
      })

      const rehydrateStarted = performance.now()
      let priorContext = yield* rehydrate(input.priorHints)
      logger.info('[chat] pre-agent history stage', {
        durationMs: Math.round(performance.now() - rehydrateStarted),
        hintCount: input.priorHints.length,
        eventCount: priorContext.groups.reduce((count, group) => count + group.events.length, 0),
      })

      if (priorContext.groups.length === 0) {
        const homeHint = homeHintsFromIds(input.homeEventIds ?? [])
        if (homeHint) {
          const homeStarted = performance.now()
          priorContext = yield* rehydrate([homeHint])
          logger.info('[chat] pre-agent home fallback stage', {
            durationMs: Math.round(performance.now() - homeStarted),
            requestedCount: homeHint.events.length,
            eventCount: priorContext.groups.reduce((count, group) => count + group.events.length, 0),
          })
        }
      }
      return priorContext
    })
    const priorContext = yield* Effect.match(contextProgram, {
      onFailure: (error) => {
        console.error('[chat] failed to build prior context:', error)
        return EMPTY_PRIOR
      },
      onSuccess: (value) => value,
    })

    input.timing?.mark('context_ready')
    const orchestrationInput = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      channel: input.channel,
      retainTask: input.retainTask,
      timing: input.timing,
      userContext: input.userContext,
      locale: normalized.locale,
      originalQuery: normalized.originalQuery,
      priorDisplayedEvents: priorContext.groups,
      venueByEventId: priorContext.venueByEventId,
      lastSearch: input.lastSearch,
      currentDateInBA: dependencies.currentDateInBA ?? currentDateInBuenosAires(),
      pin: input.pin,
      pinFacts: input.pinFacts,
      recentMessages: input.recentMessages,
      onSearchStart: input.onSearchStart,
      onTrustedSearchProgress: input.onTrustedSearchProgress,
      onProgress: input.onProgress,
      abortSignal: input.abortSignal,
    }
    return yield* dependencies.orchestrateFn
      ? Effect.tryPromise({
          try: (fiberSignal) => dependencies.orchestrateFn!({ ...orchestrationInput, abortSignal: input.abortSignal ? AbortSignal.any([input.abortSignal, fiberSignal]) : fiberSignal }),
          catch: (cause) => new SharedChatTurnError({ message: 'Chat orchestration failed', cause }),
        })
      : orchestrateEffect(orchestrationInput)
  })
}

/** Promise compatibility adapter for SvelteKit and Telegram route callers. */
export function runSharedChatTurn(
  input: SharedChatTurnInput,
  dependencies: SharedChatTurnDependencies = {},
) {
  return Effect.runPromise(runSharedChatTurnEffect(input, dependencies), { signal: input.abortSignal })
}
