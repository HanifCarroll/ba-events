import { generateObject } from 'ai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { z } from 'zod'
import { AI_BASE_URL } from '#shared/lib/ai/constants.ts'
import { NO_THINKING } from '#shared/lib/ai/providers.ts'
import { QUALITY_SYSTEM, qualityGradeSchema, validateQualityGrade, judgeInput, type QualityPacket } from './quality.ts'

export class QualityGradeError extends Error {
  constructor(message: string, readonly candidate: unknown, readonly attempts: unknown[] = []) { super(message); this.name = 'QualityGradeError' }
}

type JudgeResponse = { object: unknown; usage: unknown; response: { modelId: string; id: string } }

/** Explicit eval-only SDK leaf; valid low scores are never retried or discarded. */
export async function judgeQuality(packet: QualityPacket, model: string, request?: (prompt: string) => Promise<JudgeResponse>) {
  const provider = createDeepSeek({ apiKey: process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY,
    baseURL: AI_BASE_URL })
  const binary = z.union([z.literal(0), z.literal(1)]), rating = z.union([z.literal(0), z.literal(1), z.literal(2)])
  const schema = qualityGradeSchema.extend({
    suitability: z.object({ score: packet.cards.length ? rating : z.literal(null), reason: z.string().min(1) }),
    explanationAccuracy: z.object({ score: packet.prose.reasons.length ? binary : z.literal(null), reason: z.string().min(1) }),
  })
  const input = judgeInput(packet)
  const generate = request ?? ((prompt: string) => generateObject({ model: provider(model), schema,
    system: QUALITY_SYSTEM, prompt, temperature: 0,
    maxRetries: 0, maxOutputTokens: 6000, abortSignal: AbortSignal.timeout(30000), ...NO_THINKING }))
  const attempts: Array<{ status: 'invalid'; error: string; candidate: unknown; usage: unknown; actualModel: string; providerResponseId: string }> = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = JSON.stringify(input) + (attempts.length ? '\nPrevious grade was structurally invalid. Correct the cited identifiers/types while rechecking the same evidence. Never improve a score merely to pass validation.\n' + JSON.stringify(attempts.map(({ candidate, error }) => ({ candidate, error }))) : '')
    let result: JudgeResponse
    try { result = await generate(prompt) }
    catch {
      throw new QualityGradeError('Judge request or structured output failed', null,
        [...attempts, { status: 'request-error', error: 'Judge request or structured output failed' }])
    }
    try {
      const grade = validateQualityGrade(packet, result.object)
      return { grade, evidenceCatalog: input.sourceCatalog, proseUnits: input.proseUnits, usage: result.usage,
        actualModel: result.response.modelId, providerResponseId: result.response.id, attempts }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid judge grade'
      attempts.push({ status: 'invalid', error: message, candidate: result.object, usage: result.usage,
        actualModel: result.response.modelId, providerResponseId: result.response.id })
      if (attempt === 1) throw new QualityGradeError(message, result.object, attempts)
    }
  }
  throw new Error('Unreachable judge state')
}
