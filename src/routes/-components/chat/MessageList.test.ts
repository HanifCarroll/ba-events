import { describe, expect, it } from 'vitest'
import {
  updateAssistantTopScroll,
  type AssistantTopScrollState,
} from './MessageList'

const initialState = (): AssistantTopScrollState => ({
  pendingScrollAssistantId: null,
  prevLastAssistantId: null,
})

describe('updateAssistantTopScroll', () => {
  it('does not scroll with no in-flight request and no assistant message', () => {
    const { state, scrollToAssistantId } = updateAssistantTopScroll(initialState(), false, null)
    expect(scrollToAssistantId).toBeNull()
    expect(state).toEqual({ pendingScrollAssistantId: null, prevLastAssistantId: null })
  })

  it('remembers a new assistant message that appears while loading', () => {
    const { state, scrollToAssistantId } = updateAssistantTopScroll(
      initialState(),
      true,
      'resp-1'
    )
    expect(scrollToAssistantId).toBeNull()
    expect(state.pendingScrollAssistantId).toBe('resp-1')
    expect(state.prevLastAssistantId).toBe('resp-1')
  })

  it('keeps remembering the same message while it keeps streaming', () => {
    const pending = updateAssistantTopScroll(initialState(), true, 'resp-1').state
    const { state, scrollToAssistantId } = updateAssistantTopScroll(pending, true, 'resp-1')
    expect(scrollToAssistantId).toBeNull()
    expect(state.pendingScrollAssistantId).toBe('resp-1')
  })

  it('reports the completed response for top-alignment once loading finishes', () => {
    const pending = updateAssistantTopScroll(initialState(), true, 'resp-1').state
    const { state, scrollToAssistantId } = updateAssistantTopScroll(pending, false, 'resp-1')
    expect(scrollToAssistantId).toBe('resp-1')
    expect(state.pendingScrollAssistantId).toBeNull()
  })

  it('does not scroll when a request ends before any assistant message appeared', () => {
    const { state, scrollToAssistantId } = updateAssistantTopScroll(initialState(), false, null)
    expect(scrollToAssistantId).toBeNull()
    expect(state).toEqual({ pendingScrollAssistantId: null, prevLastAssistantId: null })
  })

  it('does not treat a loaded conversation as a finished response', () => {
    // Conversation loads happen with no request in flight (isLoading never true).
    const { state, scrollToAssistantId } = updateAssistantTopScroll(
      initialState(),
      false,
      'stored-1'
    )
    expect(scrollToAssistantId).toBeNull()
    expect(state.pendingScrollAssistantId).toBeNull()
  })

  it('tracks a fresh response across two sequential exchanges', () => {
    // Exchange 1 completes and aligns.
    const composing1 = updateAssistantTopScroll(initialState(), true, 'resp-1').state
    const done1 = updateAssistantTopScroll(composing1, false, 'resp-1')
    expect(done1.scrollToAssistantId).toBe('resp-1')

    // Exchange 2: previous response still last while loading — nothing new yet.
    const loading2 = updateAssistantTopScroll(done1.state, true, 'resp-1')
    expect(loading2.state.pendingScrollAssistantId).toBeNull()

    // New response appears…
    const composing2 = updateAssistantTopScroll(loading2.state, true, 'resp-2')
    expect(composing2.state.pendingScrollAssistantId).toBe('resp-2')

    // …and completes.
    const done2 = updateAssistantTopScroll(composing2.state, false, 'resp-2')
    expect(done2.scrollToAssistantId).toBe('resp-2')
    expect(done2.state.pendingScrollAssistantId).toBeNull()
  })

  it('clears pending without scrolling when the last assistant is not the remembered one', () => {
    const pending = updateAssistantTopScroll(initialState(), true, 'resp-1').state
    const { state, scrollToAssistantId } = updateAssistantTopScroll(pending, false, 'other-9')
    expect(scrollToAssistantId).toBeNull()
    expect(state.pendingScrollAssistantId).toBeNull()
  })
})
