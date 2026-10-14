import { describe, expect, it } from 'vitest'
import { boundedRead, ReadTimeoutError } from './bounded-read.ts'

describe('bounded tool reads', () => {
  it('aborts the underlying read at its deadline even when it never settles', async () => {
    let received: AbortSignal | undefined
    await expect(boundedRead((signal) => {
      received = signal
      return new Promise(() => {})
    }, undefined, 5)).rejects.toBeInstanceOf(ReadTimeoutError)
    expect(received?.aborted).toBe(true)
    expect(received?.reason).toBeInstanceOf(ReadTimeoutError)
  })

  it('cancels immediately without waiting for an uncooperative read', async () => {
    const parent = new AbortController()
    const reason = new Error('Producer stopped')
    let received: AbortSignal | undefined
    const result = boundedRead((signal) => {
      received = signal
      return new Promise(() => {})
    }, parent.signal, 60_000)
    parent.abort(reason)
    await expect(result).rejects.toBe(reason)
    expect(received?.aborted).toBe(true)
  })

  it('does not start a read after producer cancellation', async () => {
    const parent = new AbortController()
    parent.abort()
    let calls = 0
    await expect(boundedRead(async () => { calls++; return 'late' }, parent.signal, 5)).rejects.toBeDefined()
    expect(calls).toBe(0)
  })

  it('closes a completed read scope and clears its deadline', async () => {
    let received: AbortSignal | undefined
    expect(await boundedRead(async (signal) => { received = signal; return 'complete' }, undefined, 5)).toBe('complete')
    const completionReason = received?.reason
    expect(received?.aborted).toBe(true)
    expect(completionReason).not.toBeInstanceOf(ReadTimeoutError)
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(received?.reason).toBe(completionReason)
  })

  it('cancels outstanding sibling work when a read fails early', async () => {
    let received: AbortSignal | undefined
    const failure = new Error('One retrieval branch failed')
    await expect(boundedRead(async (signal) => {
      received = signal
      throw failure
    }, undefined, 60_000)).rejects.toBe(failure)
    expect(received?.aborted).toBe(true)
  })
})
