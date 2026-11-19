import { createOpenAI } from '@ai-sdk/openai'
import { judgeScopeBatch, requestScopeJudgments, SCOPE_MODEL } from './judge.ts'

let body: unknown
let calls = 0
const fetch: typeof globalThis.fetch = async (_url, init) => {
  calls++
  body = JSON.parse(String(init?.body))
  const content = JSON.stringify({ judgments: [{ index: 0, scope: 'in', reason: 'It is a small-room live show.' }] })
  return Response.json({ id: 'test', object: 'chat.completion', created: 1, model: SCOPE_MODEL, choices: [{ index: 0,
    message: { role: 'assistant', content }, finish_reason: 'stop' }] })
}
const model = createOpenAI({ apiKey: 'synthetic', fetch }).chat(SCOPE_MODEL)
const judgments = await judgeScopeBatch([{ name: 'Metal en vivo' }], requestScopeJudgments(model))
console.log(JSON.stringify({ body, calls, judgments }))
