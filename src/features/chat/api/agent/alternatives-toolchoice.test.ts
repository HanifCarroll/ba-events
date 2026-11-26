import { beforeAll, describe, expect, it } from 'vitest'
import { runAgentFixture } from './run-agent-fixture.ts'

describe('alternatives over the DeepSeek HTTP transport', () => {
  let results: ReturnType<typeof runAgentFixture>
  beforeAll(() => {
    results = runAgentFixture(new URL('./alternatives-toolchoice.fixture.ts', import.meta.url))
  }, 20_000)

  it.each([
    { name: 'english', stream: true, prompt: 'show me a few alternative options' },
    { name: 'spanish', stream: true, prompt: 'muéstrame algunas opciones alternativas' },
    { name: 'nonStreaming', stream: false, prompt: 'show me a few alternative options' },
  ])('completes the $name repeat without a provider error', ({ name, stream, prompt }) => {
    const { first, repeat } = results[name]
    const exhausted = name === 'spanish'
    expect(results[name].prompt).toBe(prompt)
    const ordinaryRequest = { thinking: { type: 'enabled' }, stream, status: 200 }
    expect(first).toMatchObject({ kind: 'recommendations', fallback: false, search: { timeFilter: 'today', isFree: true },
      eventIds: ['10000000-0000-4000-8000-000000000001'], requests: [ordinaryRequest, ordinaryRequest] })
    expect(repeat).toMatchObject({
      fallback: false,
      kind: exhausted ? 'no_results' : 'recommendations',
      search: { timeFilter: 'today', isFree: true },
      eventIds: exhausted ? [] : ['10000000-0000-4000-8000-000000000002'],
      requests: [
        { thinking: { type: 'disabled' }, tool_choice: { type: 'function', function: { name: 'search_events' } }, stream, status: 200 },
        ...(!exhausted ? [{ thinking: { type: 'disabled' }, stream, status: 200 }] : []),
      ],
    })
    if (exhausted) expect(repeat.text).toBe('No encontré otras opciones que coincidan con tu búsqueda.')
  })
})
