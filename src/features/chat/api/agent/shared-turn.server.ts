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
  rehydratePriorContext,
  sanitizeText,
  type PriorContext,
  type PriorResponseHint,
} from './follow-up.ts'
import { orchestrate, type OrchestrateResult } from './orchestrate.ts'
import { currentDateInBuenosAires, type LastSearchContext } from './search-context.ts'
import type { AgentHistoryMessage } from './history.ts'
import { logger } from '#shared/lib/logger.ts'

export interface SharedChatTurnInput {
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
  onTrustedSearchProgress?: () => void
}

type SharedChatTurnDependencies = {
  fetchEventFacts?: typeof getEventFactsByIds
  getSavedMembership?: typeof getSavedMembershipForIds
  orchestrateFn?: typeof orchestrate
  currentDateInBA?: string
}

const EMPTY_PRIOR: PriorContext = { groups: [], venueByEventId: new Map() }

export function normalizeChatTurn(text: string, fallbackLocale: 'en' | 'es') {
  const originalQuery = sanitizeText(text, MAX_USER_TEXT)
  return {
    originalQuery,
    locale: detectResponseLanguage(originalQuery, fallbackLocale),
  }
}

/** Channel-neutral server entry point after channel-specific history parsing and pin resolution. */
export async function runSharedChatTurn(
  input: SharedChatTurnInput,
  dependencies: SharedChatTurnDependencies = {}
): Promise<OrchestrateResult> {
  const fetchEventFacts = dependencies.fetchEventFacts ?? getEventFactsByIds
  const getSavedMembership = dependencies.getSavedMembership ?? getSavedMembershipForIds
  const normalized = normalizeChatTurn(input.text, input.locale)
  let priorContext = EMPTY_PRIOR

  try {
    const membershipIds = collectEventIds(input.priorHints)
    const membershipStarted = performance.now()
    const membership = input.userContext.isAuthenticated
      ? await getSavedMembership(input.userContext, membershipIds)
      : undefined
    logger.info('[chat] pre-agent membership stage', {
      durationMs: Math.round(performance.now() - membershipStarted),
      requestedCount: membershipIds.length,
      authenticated: input.userContext.isAuthenticated,
      resultCount: membership?.status === 'complete' ? membership.savedIds.size : 0,
    })

    const rehydrateStarted = performance.now()
    priorContext = await rehydratePriorContext(input.priorHints, fetchEventFacts, membership)
    logger.info('[chat] pre-agent history stage', {
      durationMs: Math.round(performance.now() - rehydrateStarted),
      hintCount: input.priorHints.length,
      eventCount: priorContext.groups.reduce((count, group) => count + group.events.length, 0),
    })

    if (priorContext.groups.length === 0) {
      const homeHint = homeHintsFromIds(input.homeEventIds ?? [])
      if (homeHint) {
        const homeIds = collectEventIds([homeHint])
        const homeStarted = performance.now()
        const homeMembership = input.userContext.isAuthenticated
          ? await getSavedMembership(input.userContext, homeIds)
          : undefined
        priorContext = await rehydratePriorContext([homeHint], fetchEventFacts, homeMembership)
        logger.info('[chat] pre-agent home fallback stage', {
          durationMs: Math.round(performance.now() - homeStarted),
          requestedCount: homeIds.length,
          eventCount: priorContext.groups.reduce((count, group) => count + group.events.length, 0),
        })
      }
    }
  } catch (error) {
    console.error('[chat] failed to build prior context:', error)
  }

  return (dependencies.orchestrateFn ?? orchestrate)({
    requestId: input.requestId,
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
    onTrustedSearchProgress: input.onTrustedSearchProgress,
  })
}
