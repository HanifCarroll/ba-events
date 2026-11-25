import { existsSync, readFileSync } from 'node:fs'
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
export const finding = z.discriminatedUnion('verdict', [
  z.strictObject({ verdict: z.literal('ok'), reason: line(300), url: webUrl }),
  z.strictObject({ verdict: z.literal('fixed'), fixes: z.array(z.uuid()).min(1).max(12) }),
  z.strictObject({ verdict: z.literal('exclude'), reason: line(300) }),
  z.strictObject({ verdict: z.literal('ask'), question: line(300), checked: line(500), hermes: line(300).optional() }),
])
export type Finding = z.infer<typeof finding>
export type Findings = Record<string, Finding>
export interface Investigation {
  request: InvestigationRequest
  round: number
  findings?: Findings
  failure?: string
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
