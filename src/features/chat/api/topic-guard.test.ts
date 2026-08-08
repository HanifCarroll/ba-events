import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateObjectMock = vi.hoisted(() => vi.fn())

vi.mock('ai', () => ({
  generateObject: generateObjectMock,
}))

import { guardForOffTopic } from './topic-guard'

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
})
