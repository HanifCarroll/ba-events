import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

import { generateObject } from 'ai'
import { guardForOffTopic } from './topic-guard'

// The mocked module export IS the mock fn; cast only for typing
// (bun test does not provide vi.mocked).
const generateObjectMock = generateObject as unknown as Mock

describe('guardForOffTopic', () => {
  beforeEach(() => {
    generateObjectMock.mockReset()
  })

  it('returns null for on-topic replies', async () => {
    generateObjectMock.mockResolvedValue({ object: { on_topic: true } })

    const result = await guardForOffTopic('Go to Smoked at La Rural tonight.', 'en')

    expect(result).toBeNull()
  })

  it('returns an English refusal for off-topic replies', async () => {
    generateObjectMock.mockResolvedValue({ object: { on_topic: false } })

    const result = await guardForOffTopic('def fib(n): return n if n < 2 else fib(n-1)+fib(n-2)', 'en')

    expect(result).toMatch(/concierge/)
    expect(result).not.toMatch(/fib/)
  })

  it('returns a Spanish refusal for off-topic replies in es', async () => {
    generateObjectMock.mockResolvedValue({ object: { on_topic: false } })

    const result = await guardForOffTopic('Escribe una función en Python', 'es')

    expect(result).toMatch(/Solo recomiendo eventos/)
  })

  it('fails open when the classifier errors', async () => {
    generateObjectMock.mockRejectedValue(new Error('classifier down'))

    const result = await guardForOffTopic('Go to a jazz bar in San Telmo.', 'en')

    expect(result).toBeNull()
  })

  it('skips empty replies without calling the classifier', async () => {
    const result = await guardForOffTopic('   ', 'en')

    expect(result).toBeNull()
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('feeds the user query and attached event names to the classifier', async () => {
    generateObjectMock.mockResolvedValue({ object: { on_topic: true } })

    const result = await guardForOffTopic(
      'IA para PyMEs — charla gratuita el jueves en Paseo Colón 1380.',
      'es',
      { query: 'Contame sobre IA para PyMEs', eventNames: ['IA para PyMEs'] }
    )

    expect(result).toBeNull()
    const classifierPrompt = generateObjectMock.mock.calls[0][0].prompt as string
    expect(classifierPrompt).toContain('Contame sobre IA para PyMEs')
    expect(classifierPrompt).toContain('IA para PyMEs')
  })

  it('omits the context block when no context is given', async () => {
    generateObjectMock.mockResolvedValue({ object: { on_topic: true } })

    await guardForOffTopic('Go to Smoked at La Rural tonight.', 'en')

    const classifierPrompt = generateObjectMock.mock.calls[0][0].prompt as string
    expect(classifierPrompt).not.toContain('Context:')
  })
})
