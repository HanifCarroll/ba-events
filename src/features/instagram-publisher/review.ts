import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import type { Investigation } from './investigation.ts'
import type { FormatKey } from './formats.ts'
import type { SourceEvidence } from './review-evidence.ts'
import type { QuestionResolution } from './review-resolution.ts'
import type { PostEvent } from './select.ts'

const fields = {
  verdict: z.enum(['ok', 'wrong', 'question']),
  field: z.string().nullable(),
  reason: z.string().nullable(),
  question: z.string().nullable(),
}
const verdict = z.strictObject(fields)
const output = z.strictObject({ post: verdict, events: z.array(z.strictObject({ id: z.string(), ...fields })) })
const { $schema: _schemaVersion, ...schema } = z.toJSONSchema(output)

export type Verdict = z.infer<typeof verdict>
export type ReviewEvidenceFlag = Pick<Verdict, 'field' | 'question' | 'reason'>
export const OK: Verdict = { verdict: 'ok', field: null, reason: null, question: null }
export interface ReviewInput {
  format: FormatKey
  from: string
  to: string
  caption: string | null
  threads: string | null
  events: PostEvent[]
  frames: string[]
  reelHoldMids?: number[]
}
export type ReviewOutput = z.infer<typeof output> & { model: string }
export type Reviewer = (input: ReviewInput) => Promise<ReviewOutput>
export interface ReviewResult extends ReviewOutput {
  revision: number
  framesHash: string
  copyHash: string
  startedAt: string
  completedAt: string
  questionResolution?: { quick?: QuestionResolution; fallback?: QuestionResolution }
}
export interface ReviewState {
  reelHoldMids?: number[]
  result?: ReviewResult
  replied?: boolean
  /** Legacy notification reservation. Saved drafts with this flag must not broadcast a decision again. */
  homeAttempted?: boolean
  unavailableAlert?: boolean
  investigatorEnabled?: boolean
  investigation?: Investigation
}
export interface ReviewConfig { model: string; keyFile: string }

/** Bind the result to the exact outgoing texts, picks, date window, and Reel card sample times, not just the images. */
export const copyHash = ({ frames: _paths, ...content }: ReviewInput) => createHash('sha256').update(JSON.stringify(content)).digest('hex')
export const allOk = ({ post, events }: ReviewOutput) => post.verdict === 'ok' && events.every(event => event.verdict === 'ok')

export function validateReview<T extends ReviewOutput>(input: ReviewInput, result: T): T {
  const expected = new Set(input.events.map(event => event.id))
  const valid = (item: Verdict) => {
    const line = (text: string | null, max: number) => text !== null && text.length <= max && text.trim() !== '' && !/[\r\n\x00-\x1f\x7f]/u.test(text)
    if (item.verdict === 'ok') return item.field === null && item.reason === null && item.question === null
    if (item.verdict === 'wrong') return line(item.field, 40) && line(item.reason, 300) && item.question === null
    return item.verdict === 'question' && (item.field === null || line(item.field, 40)) && item.reason === null && line(item.question, 300)
  }
  if (!result.model?.trim() || !valid(result.post) || !result.events.every(event => expected.delete(event.id) && valid(event)) || expected.size) {
    throw new Error('OpenAI review returned invalid or incomplete verdicts.')
  }
  return result
}

const text = (value: string) => ({ type: 'input_text', text: value })
const image = (dataUrl: string) => ({ type: 'input_image', image_url: dataUrl, detail: 'high' })
const jpeg = (path: string) => `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`

export function readReviewKey(path: string) {
  try {
    const info = statSync(path)
    if (!info.isFile() || (info.mode & 0o777) !== 0o600) throw new Error()
    const key = readFileSync(path, 'utf8').trim()
    if (!/^\S+$/.test(key)) throw new Error()
    return key
  } catch { throw new Error('Cannot read the OpenAI review key. Check review.keyFile and mode 600.') }
}

/** Only the fixed API endpoint receives the key. Never surface provider response text or request bodies in logs. */
export async function reviewWithOpenAI(config: ReviewConfig, key: string, prompt: string, input: ReviewInput, stills: string[],
  sources: ReadonlyMap<string, SourceEvidence>, fetchImpl: typeof fetch = fetch): Promise<ReviewOutput> {
  if (stills.length !== input.events.length + 2) throw new Error('Review needs a cover, one card per event, and a closing frame.')
  const parts: Array<ReturnType<typeof text> | ReturnType<typeof image>> = [
    text(JSON.stringify({ format: input.format, from: input.from, to: input.to, caption: input.caption, threads: input.threads })),
    text('Rendered cover:'), image(jpeg(stills[0]!)),
  ]
  for (const [index, event] of input.events.entries()) {
    const { flyer, ...source } = sources.get(event.id) ?? {}
    parts.push(text(JSON.stringify({ catalog: event, linkedEvidence: source })), text(`Rendered card for ${event.id}:`), image(jpeg(stills[index + 1]!)))
    if (flyer) parts.push(text(`Intake source image for ${event.id}:`), image(flyer))
  }
  parts.push(text('Rendered closing frame:'), image(jpeg(stills.at(-1)!)))
  const { output: data, model } = await requestReviewJson(config, key, prompt, parts, 'publisher_review', schema, fetchImpl)
  const parsed = output.safeParse(data)
  if (!parsed.success) throw new Error('OpenAI review did not return the required verdict format.')
  return validateReview(input, { ...parsed.data, model })
}

export async function requestReviewJson(config: ReviewConfig, key: string, prompt: string,
  parts: Array<ReturnType<typeof text> | ReturnType<typeof image>>, name: string, schema: Record<string, unknown>, fetchImpl: typeof fetch,
  timeout = 90_000) {
  let response: Response
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, instructions: prompt, input: [{ role: 'user', content: parts }], store: false,
        reasoning: { effort: 'low' }, max_output_tokens: 3200,
        text: { format: { type: 'json_schema', name, strict: true, schema } } }),
    })
  } catch { throw new Error('OpenAI review request failed or timed out.') }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`OpenAI review returned HTTP ${response.status}.`)
  }
  const envelope = z.object({ status: z.literal('completed'), model: z.string(), output: z.array(z.object({
    type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })) }).safeParse(await response.json().catch(() => null))
  if (!envelope.success) throw new Error('OpenAI review did not complete.')
  const messages = envelope.data.output.filter(item => item.type === 'message').flatMap(item => item.content ?? [])
  const json = messages.length === 1 && messages[0]?.type === 'output_text' ? messages[0].text : undefined
  let data: unknown
  try { data = json === undefined ? null : JSON.parse(json) } catch { throw new Error('OpenAI review did not return JSON.') }
  return { model: envelope.data.model, output: data }
}
