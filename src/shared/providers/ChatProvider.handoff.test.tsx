import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { renderHook, act, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { ChatProvider, useChatContext } from './ChatProvider'

// Bun's test runner has no DOM: bootstrap jsdom globals manually (vitest's
// @vitest-environment pragma is ignored by `bun test`).
const dom = new JSDOM('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  getComputedStyle: dom.window.getComputedStyle,
})

const wrapper = ({ children }: { children: ReactNode }) => <ChatProvider>{children}</ChatProvider>

describe('ChatProvider first-message handoff', () => {
  afterEach(cleanup)

  it('peek is non-destructive and take is one-shot', () => {
    const { result } = renderHook(() => useChatContext(), { wrapper })

    expect(result.current.peekPendingFirstMessage()).toBeNull()

    const parked = { content: 'hola', eventId: undefined, handoffId: 'h-1' }
    act(() => {
      result.current.setPendingFirstMessage(parked)
    })

    // Peek may be called any number of times (render is not idempotent-safe
    // otherwise) and must not clear the parked message.
    expect(result.current.peekPendingFirstMessage()).toEqual(parked)
    expect(result.current.peekPendingFirstMessage()).toEqual(parked)

    // Take clears on read: the second call returns null, so repeated mount
    // effects can never double-send.
    expect(result.current.takePendingFirstMessage()).toEqual(parked)
    expect(result.current.takePendingFirstMessage()).toBeNull()
    expect(result.current.peekPendingFirstMessage()).toBeNull()
  })

  it('a later park overwrites an earlier one', () => {
    const { result } = renderHook(() => useChatContext(), { wrapper })

    act(() => {
      result.current.setPendingFirstMessage({ content: 'first', handoffId: 'h-1' })
    })
    act(() => {
      result.current.setPendingFirstMessage({ content: 'second', eventId: 'evt-1', handoffId: 'h-2' })
    })

    expect(result.current.takePendingFirstMessage()).toEqual({
      content: 'second',
      eventId: 'evt-1',
      handoffId: 'h-2',
    })
  })
})
