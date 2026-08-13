import { useState } from 'react'
import { JSDOM } from 'jsdom'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatProvider, useChatContext } from './ChatProvider'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
})

function ScrollMemoryProbe() {
  const { saveConversationScrollPosition, getConversationScrollPosition } = useChatContext()
  const [value, setValue] = useState<number | null>(null)

  return (
    <>
      <button onClick={() => saveConversationScrollPosition('conversation-a', 248)}>
        Save A
      </button>
      <button onClick={() => saveConversationScrollPosition('conversation-b', 64)}>
        Save B
      </button>
      <button onClick={() => setValue(getConversationScrollPosition('conversation-a'))}>
        Read A
      </button>
      <button onClick={() => setValue(getConversationScrollPosition('conversation-b'))}>
        Read B
      </button>
      <output>{value ?? 'none'}</output>
    </>
  )
}

describe('ChatProvider conversation scroll memory', () => {
  afterEach(cleanup)

  it('keeps independent scroll positions per conversation', () => {
    const { getByRole } = render(
      <ChatProvider>
        <ScrollMemoryProbe />
      </ChatProvider>
    )

    fireEvent.click(getByRole('button', { name: 'Save A' }))
    fireEvent.click(getByRole('button', { name: 'Save B' }))
    fireEvent.click(getByRole('button', { name: 'Read A' }))
    expect(getByRole('status').textContent).toBe('248')

    fireEvent.click(getByRole('button', { name: 'Read B' }))
    expect(getByRole('status').textContent).toBe('64')
  })
})
