import { logger } from '#shared/lib/logger.ts'

export type ChatTimingPhase = 'ingress' | 'generate' | 'commit' | 'fail' | 'delivery' | 'workflow'
export type ChatTimingStage =
  | 'request_entry' | 'session_ready' | 'route_entry' | 'body_ready' | 'execution_verified'
  | 'identity_ready' | 'delivery_forward_start' | 'delivery_headers'
  | 'durable_input_ready' | 'workflow_admission_start' | 'workflow_admitted' | 'workflow_admission_unknown' | 'workflow_started'
  | 'workflow_dispatch_received' | 'admitted_generation_start' | 'existing_producer_joined' | 'execution_fetch_start' | 'execution_headers'
  | 'rate_limit_start' | 'rate_limit_ready' | 'rate_limit_rejected'
  | 'claim_ready' | 'pin_ready' | 'history_ready' | 'guest_lifecycle_ready' | 'context_ready'
  | 'provider_init_start' | 'provider_ready' | 'model_start'
  | 'trace_flush_start' | 'trace_flush_complete' | 'generation_complete'
  | 'checkpoint_start' | 'checkpoint_ready' | 'commit_gate_start' | 'commit_gate_ready'
  | 'persistence_ready' | 'final_written' | 'first_preview_published' | 'final_published'
export interface ChatTiming { mark(stage: ChatTimingStage): void }
export interface ChatTimingSample {
  version: 'chat-timing-v1'; requestId: string; phase: ChatTimingPhase; stage: ChatTimingStage
  scope: 'request' | 'delivery_start' | 'admission' | 'dispatch' | 'producer' | 'workflow'
  elapsedMs: number; durationMs: number; sinceAdmissionMs?: number | null
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_TIMING: ChatTiming = { mark: () => {} }

/** Server logs only. Durations share a local monotonic clock; wall timestamps
 * correlate workers, and persisted admission time explicitly measures that gap.
 * The allowlisted payload contains no headers, capabilities, text or user IDs.
 */
export function createChatTiming(identity: { requestId: string; phase: ChatTimingPhase; admittedAtMs?: number; scope?: ChatTimingSample['scope'] },
  dependencies: { now?: () => number; wallNow?: () => number; emit?: (sample: ChatTimingSample) => void } = {}): ChatTiming {
  if (!uuid.test(identity.requestId)) return NO_TIMING
  const now = dependencies.now ?? (() => performance.now())
  const wallNow = dependencies.wallNow ?? Date.now
  const emit = dependencies.emit ?? (sample => logger.info('[chat] timing', { ...sample }))
  const started = now()
  let previous = started
  return { mark(stage) {
    try {
      const current = now()
      if (!Number.isFinite(current)) return
      const admission = identity.admittedAtMs
      const sinceAdmissionMs = admission === undefined ? undefined : wallNow() - admission
      emit({ version: 'chat-timing-v1', requestId: identity.requestId, phase: identity.phase, stage,
        scope: identity.scope ?? 'request',
        elapsedMs: Math.max(0, Math.round(current - started)), durationMs: Math.max(0, Math.round(current - previous)),
        ...(sinceAdmissionMs === undefined ? {} : { sinceAdmissionMs: Number.isFinite(sinceAdmissionMs) && sinceAdmissionMs >= 0 ? Math.round(sinceAdmissionMs) : null }) })
      previous = current
    } catch { /* Observability must never change admission, execution or publication. */ }
  } }
}

export function requestChatTiming(event: { request: Request; locals: { chatTiming?: ChatTiming } }): ChatTiming {
  const path = new URL(event.request.url).pathname
  if (path !== '/api/chat' && path !== '/api/chat/execute') return NO_TIMING
  const requestId = event.request.headers.get('x-chat-attempt') ?? ''
  // Missing/invalid correlation must not access downstream request context.
  if (!uuid.test(requestId)) return NO_TIMING
  if (event.locals.chatTiming) return event.locals.chatTiming
  const stage = event.request.headers.get('x-chat-execution-stage')
  const phase = path === '/api/chat' ? 'ingress' : stage === 'commit' || stage === 'fail' ? stage : 'generate'
  const timing = createChatTiming({ requestId, phase })
  event.locals.chatTiming = timing
  return timing
}
