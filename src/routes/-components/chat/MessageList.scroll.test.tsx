import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { render } from '@testing-library/react'
import { MessageList } from './MessageList'
import type { ChatMessage as ChatMessageType } from '@/shared/lib/types'

// Bun's test runner has no DOM: bootstrap jsdom globals manually (vitest's
// @vitest-environment pragma is ignored by `bun test`).
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
})
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  MutationObserver: dom.window.MutationObserver,
})

// Isolate MessageList from the full component tree (EventList, cards, auth
// providers). The mock still renders data-message-id so the completion-scroll
// effect can find the assistant message in the DOM.
vi.mock('./ChatMessage', () => ({
  ChatMessage: ({ message }: { message: ChatMessageType }) => (
    <div data-message-id={message.id}>{message.content}</div>
  ),
}))

const userMessage = (id: string): ChatMessageType => ({
  id,
  role: 'user',
  content: 'user text',
  timestamp: new Date('2026-08-08T20:00:00Z'),
})

const assistantMessage = (id: string, isStreaming: boolean): ChatMessageType => ({
  id,
  role: 'assistant',
  content: isStreaming ? '' : 'assistant response',
  timestamp: new Date('2026-08-08T20:00:00Z'),
  isStreaming,
})

describe('MessageList completion top-alignment', () => {
  let scrollCalls: Array<{ el: unknown; args: ScrollToOptions[] }>

  beforeEach(() => {
    // jsdom has no layout: stub geometry so the effect computes a known target.
    // Scroll container top: 80, assistant message top: 320, scrollTop: 0.
    dom.window.HTMLElement.prototype.getBoundingClientRect = vi.fn(function (
      this: HTMLElement
    ) {
      const top = this.hasAttribute('data-message-id') ? 320 : 80
      return {
        top,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })
    // jsdom does not implement scrolling; capture calls instead.
    // (Bun's vi.fn() does not populate mock.instances, so record `this` here.)
    scrollCalls = []
    // The real scrollTo has (options) and (x, y) overloads; the stub only
    // handles the options form, so cast it to the DOM signature.
    const scrollToStub = vi.fn(function (this: Element, options: ScrollToOptions) {
      scrollCalls.push({ el: this, args: [options] })
    }) as unknown as typeof dom.window.Element.prototype.scrollTo
    dom.window.Element.prototype.scrollTo = scrollToStub
    dom.window.Element.prototype.scrollIntoView = vi.fn()
  })

  it('does not scroll while the response is still streaming', () => {
    render(
      <MessageList
        messages={[userMessage('u1'), assistantMessage('a1', true)]}
        isLoading
      />
    )

    expect(scrollCalls).toHaveLength(0)
  })

  it('scrolls the finished assistant response to the top with padding once loading ends', () => {
    const { container, rerender } = render(
      <MessageList messages={[userMessage('u1'), assistantMessage('a1', true)]} isLoading />
    )

    // Response completes: streaming stops and the request ends.
    rerender(<MessageList messages={[userMessage('u1'), assistantMessage('a1', false)]} />)

    expect(scrollCalls).toHaveLength(1)
    // 320 (message top) - 80 (container top) + 0 (scrollTop) - 24 (padding)
    expect(scrollCalls[0].args[0].top).toBe(216)
    // The effect scrolls the message list root's parent element — in this
    // render that is the wrapper RTL mounted into.
    expect(scrollCalls[0].el).toBe(container)
  })

  it('does not scroll when a conversation is loaded with no request in flight', () => {
    const { container } = render(
      <MessageList messages={[userMessage('u1'), assistantMessage('a1', false)]} />
    )

    expect(scrollCalls).toHaveLength(0)
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(2)
  })

  it('does not scroll when a request ends without an assistant message', () => {
    const { container, rerender } = render(
      <MessageList messages={[userMessage('u1')]} isLoading />
    )

    rerender(<MessageList messages={[userMessage('u1')]} />)

    expect(scrollCalls).toHaveLength(0)
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(1)
  })
})
