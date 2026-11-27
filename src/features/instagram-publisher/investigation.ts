import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { line } from './catalog-fix.ts'
import type { Draft } from './job.ts'
import { copyHash, type ReviewInput, type ReviewResult, type Verdict } from './review.ts'

export const MAX_INVESTIGATIONS = 2
export const flagged = (review: ReviewResult) => review.events.filter(event => event.verdict !== 'ok')

export interface InvestigationRequest {
  id: string
  revision: number
  framesHash: string
  copyHash: string
  startsAt: number
  endsAt: number
  cutoff: string
  slot: string
  input: ReviewInput
  events: Array<Verdict & { id: string; title: string }>
}

const webUrl = z.url({ protocol: /^https?$/u }).max(500)
const checked = line(500)
export const finding = z.discriminatedUnion('verdict', [
  z.strictObject({ verdict: z.literal('ok'), reason: line(300), url: webUrl, checked: checked.optional() }),
  z.strictObject({ verdict: z.literal('fixed'), fixes: z.array(z.uuid()).min(1).max(12), checked: checked.optional() }),
  z.strictObject({ verdict: z.literal('exclude'), reason: line(300), hermes: line(300).optional(), checked: checked.optional() }),
  z.strictObject({ verdict: z.literal('ask'), question: line(300), field: line(40).optional(), checked, hermes: line(300).optional() }),
])
export type Finding = z.infer<typeof finding>
export type Findings = Record<string, Finding>
export interface Investigation {
  request: InvestigationRequest
  round: number
  missedUnitProbes?: number
  findings?: Findings
  /** Findings synthesized from the quick review, not questions returned by the investigator. */
  fallback?: boolean
  repairAlertQueued?: boolean
  failure?: string
  /** This revision may no longer match the catalog after a submitted correction. */
  catalogWriteHold?: boolean
  failureAlerted?: boolean
  replied?: boolean
}

export const location = (stateDir: string, { id, revision }: Pick<InvestigationRequest, 'id' | 'revision'>) =>
  join(stateDir, 'drafts', id, `investigation-${revision}`)
export const unitName = ({ id, revision, startsAt }: InvestigationRequest) => `ba-events-instagram-investigator-${id}-r${revision}-${startsAt}`
export const endTime = (now: number, cutoff: Date) => Math.min(now + 30 * 60_000, cutoff.getTime() - 20 * 60_000)

export function requestMatches(request: InvestigationRequest, draft: Draft, input: ReviewInput) {
  return request.id === draft.id && request.revision === draft.revision && request.framesHash === draft.framesHash && request.copyHash === copyHash(input)
}

export function askAll(events: InvestigationRequest['events'], checked: string): Findings {
  return Object.fromEntries(events.map(event => [event.id, { verdict: 'ask',
    question: event.question ?? `Should we publish “${event.title}” as shown? ${event.reason ?? ''}`.trim(), checked }]))
}

export const readJson = (path: string): unknown => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/** A completion marker is published only after Pi exits cleanly. No partial batch can clear the review gate. */
export function readFindings(dir: string, request: InvestigationRequest, now: number): Findings | null {
  const completed = z.object({ at: z.number() }).safeParse(readJson(join(dir, 'completed.json')))
  if (!completed.success || completed.data.at < request.startsAt || completed.data.at > Math.min(now, request.endsAt)) return null
  const results: Findings = {}
  for (const { id } of request.events) {
    const result = z.object({ at: z.number(), finding }).safeParse(readJson(join(dir, `${id}.result.json`)))
    if (!result.success || result.data.at < request.startsAt || result.data.at > completed.data.at) return null
    results[id] = result.data.finding
  }
  return results
}

export const hasCompleted = (dir: string) => existsSync(join(dir, 'completed.json'))

const recordedRequest = z.object({ id: z.string(), revision: z.number(), startsAt: z.number(), endsAt: z.number(), events: z.array(z.object({ id: z.string() })) })
const recordedResult = z.object({ at: z.number(), finding })
export type RecordedCheck = { revision: number; finding: Finding }

/** Individual on-time findings are useful evidence even if the round didn't finish. Never use them to clear a review gate. */
export function readRecordedChecks(stateDir: string, draft: Pick<Draft, 'id' | 'revision'>, ids: string[], now: number, includeCurrent: boolean) {
  const root = join(stateDir, 'drafts', draft.id)
  const checks = new Map<string, RecordedCheck[]>()
  if (!existsSync(root)) return checks
  const revisions = readdirSync(root).flatMap(name => {
    const number = /^investigation-(\d+)$/u.exec(name)?.[1]
    return number ? [Number(number)] : []
  }).filter(revision => revision < draft.revision || (includeCurrent && revision === draft.revision)).sort((a, b) => a - b)
  for (const revision of revisions) {
    const dir = location(stateDir, { id: draft.id, revision })
    const request = recordedRequest.safeParse(readJson(join(dir, 'request.json')))
    if (!request.success || request.data.id !== draft.id || request.data.revision !== revision) continue
    const { startsAt, endsAt, events } = request.data
    for (const id of ids) {
      if (!/^[\da-f-]{36}$/u.test(id) || !events.some(event => event.id === id)) continue
      const saved = recordedResult.safeParse(readJson(join(dir, `${id}.result.json`)))
      if (!saved.success || saved.data.at < startsAt || saved.data.at > Math.min(now, endsAt)) continue
      const items = checks.get(id) ?? []
      items.push({ revision, finding: saved.data.finding })
      checks.set(id, items)
    }
  }
  return checks
}
