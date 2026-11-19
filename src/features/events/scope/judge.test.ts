import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it, vi } from 'vitest'
import { decodeScopeJudgments, judgeScopeBatch, precheckScope, requestScopeJudgments, SCOPE_MODEL } from './judge.ts'

const inScope = { scope: 'in', reason: 'It is a small-room live show.' }
const unclear = { scope: 'out', reason: 'unclear: The listing does not say what takes place.' }

describe('scope judgment', () => {
  it('pre-checks only unqualified club titles, not genres, venues, or ambiguous party words', async () => {
    const request = vi.fn(async () => ({ judgments: [{ index: 1, ...unclear }, { index: 0, ...inScope }] }))
    expect(precheckScope({ name: '   NOCHE DE BOLÍCHE ' })).toMatchObject({ scope: 'out' })
    expect(precheckScope({ name: 'Fiesta del Libro' })).toBeUndefined()
    expect(precheckScope({ name: 'After Office: sesión de jazz en vivo' })).toBeUndefined()
    expect(precheckScope({ name: 'After Office', descriptionEs: 'Una obra de teatro de humor.' })).toBeUndefined()
    const live = { name: 'Trap y Metal en Sala Chica', source: 'passline' }
    const ambiguous = { name: 'Encuentro', source: 'instagram-intake' }
    expect(await judgeScopeBatch([{ name: 'Club Night' }, live, ambiguous], request))
      .toEqual([expect.objectContaining({ scope: 'out' }), inScope, unclear])
    expect(request).toHaveBeenCalledWith([live, ambiguous])
  })

  it('rejects partial, extra, duplicate, mislabeled, or unreasoned output', () => {
    const valid = { index: 0, ...inScope }
    for (const value of [null, { judgments: [] }, { judgments: [valid], extra: 1 },
      { judgments: [{ ...valid, index: 1 }] }, { judgments: [{ ...valid, scope: 'maybe' }] },
      { judgments: [{ ...valid, reason: '' }] }, { judgments: [{ ...valid, reason: 'It is an open-访问 installation.' }] },
      { judgments: [{ ...valid, reason: unclear.reason }] },
      { judgments: [{ ...valid, internal: true }] }]) {
      expect(() => decodeScopeJudgments(value, 1)).toThrow()
    }
    expect(() => decodeScopeJudgments({ judgments: [valid, valid] }, 2)).toThrow()
  })

  it('requests native strict JSON with no reasoning, tools, or storage', async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ model: SCOPE_MODEL, response_format: { type: 'json_schema', json_schema: { strict: true } },
        reasoning_effort: 'none', store: false })
      expect(body).not.toHaveProperty('tools')
      return Response.json({ id: 'test', object: 'chat.completion', created: 1, model: SCOPE_MODEL, choices: [{ index: 0,
        message: { role: 'assistant', content: JSON.stringify({ judgments: [{ index: 0, ...inScope }] }) }, finish_reason: 'stop' }] })
    })
    const model = createOpenAI({ apiKey: 'synthetic', fetch: transport }).chat(SCOPE_MODEL)
    expect(await judgeScopeBatch([{ name: 'Metal en vivo' }], requestScopeJudgments(model))).toEqual([inScope])
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
