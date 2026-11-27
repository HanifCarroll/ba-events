import { z } from 'zod'
import { line } from './catalog-fix.ts'
import type { ReviewResources } from './review-evidence.ts'
import { publicReviewUrl, type ReviewBarrioLookup } from './review-reply.ts'
import { requestReviewJson, type ReviewConfig, type ReviewInput } from './review.ts'

const citation = z.strictObject({ url: line(2048), quote: line(400) })
const decision = z.strictObject({ id: z.string(), verdict: z.enum(['ok', 'wrong']), field: line(40), reason: line(300),
  citations: z.array(citation).min(1).max(3) })
const resultSchema = z.strictObject({ resolved: z.array(decision) })
const { $schema: _version, ...schema } = z.toJSONSchema(resultSchema)

type Resolution = z.infer<typeof decision> & { question: string }
export interface QuestionResolution { model: string | null; resolved: Resolution[] }
export interface ReviewQuestion {
  id: string
  question: string
  field: string | null
  evidence: ReviewResources | undefined
  usig: ReviewBarrioLookup | null
}
export type QuestionResolver = (input: ReviewInput, questions: ReviewQuestion[]) => Promise<QuestionResolution>

function documents({ evidence, usig }: ReviewQuestion) {
  const observations = (evidence?.observations ?? []).filter(observation => publicReviewUrl(observation.postUrl))
  const officialPages = (evidence?.officialPages ?? []).filter(page => publicReviewUrl(page.url))
  return { observations, officialPages, usig: usig?.barrio ? usig : null }
}

export async function resolveReviewQuestionsWithOpenAI(config: ReviewConfig, key: string, instructions: string, input: ReviewInput,
  questions: ReviewQuestion[], fetchImpl: typeof fetch = fetch): Promise<QuestionResolution> {
  const events = questions.map(({ id, field, question, evidence, usig }) => ({ id, field, question,
    card: input.events.find(event => event.id === id), address: evidence?.address, ...documents({ id, field, question, evidence, usig }) }))
    .filter(event => event.observations.length || event.officialPages.length || event.usig)
  if (!events.length) return { model: null, resolved: [] }
  const { format, from, to, caption, threads } = input
  const { model, output } = await requestReviewJson(config, key, instructions,
    [{ type: 'input_text', text: JSON.stringify({ format, from, to, caption, threads, events }) }],
    'publisher_question_resolution', schema, fetchImpl, 25_000)
  const parsed = resultSchema.safeParse(output)
  if (!parsed.success || !model.trim()) throw new Error('OpenAI did not return valid publisher question resolutions.')
  const resolved = parsed.data.resolved.flatMap(item => {
    const event = events.find(event => event.id === item.id)
    if (!event || parsed.data.resolved.filter(entry => entry.id === item.id).length !== 1) return []
    // Don't accept a model's paraphrase, a citation from another event, or a URL that isn't in the supplied evidence.
    const verified = item.citations.every(({ url, quote }) => {
      if (event.usig?.url === url && event.usig.barrio === quote) return true
      return event.officialPages.some(page => page.url === url && page.excerpt.includes(quote)) ||
        event.observations.some(source => source.postUrl === url &&
          (source.caption.includes(quote) || source.excerpts.some(excerpt => excerpt.excerpt.includes(quote))))
    })
    return verified ? [{ ...item, question: event.question }] : []
  })
  return { model, resolved }
}
