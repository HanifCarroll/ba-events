import { describe, expect, it } from 'vitest'
import {
  assistantMessageHasVisibleContent,
  mapStatusPhaseToRequestPhase,
  shouldShowLoadingIndicator,
} from './ChatContainer'

describe('ChatContainer loading/visibility selectors', () => {
  it('treats empty streaming assistant output as not visible', () => {
    expect(
      assistantMessageHasVisibleContent({
        content: '',
      })
    ).toBe(false)
  })

  it('treats final assistant text as visible content', () => {
    expect(
      assistantMessageHasVisibleContent({
        content: 'Go to Club 69 tonight.',
      })
    ).toBe(true)
  })

  it('shows loading while submitted', () => {
    expect(shouldShowLoadingIndicator('submitted', null, 'idle')).toBe(true)
  })

  it('shows loading during streaming when assistant has no visible content', () => {
    expect(
      shouldShowLoadingIndicator('streaming', {
        content: '',
      }, 'idle')
    ).toBe(true)
  })

  it('hides loading once final assistant content is visible', () => {
    expect(
      shouldShowLoadingIndicator('streaming', {
        content: 'Go to Club 69 tonight.',
      }, 'idle')
    ).toBe(false)
  })

  it('shows loading immediately during preparing phase for first message UX', () => {
    expect(shouldShowLoadingIndicator('ready', null, 'preparing')).toBe(true)
  })

  it('maps server status phases to request lifecycle phases', () => {
    expect(mapStatusPhaseToRequestPhase('thinking')).toBe('thinking')
    expect(mapStatusPhaseToRequestPhase('calling_tool')).toBe('running_tool')
    expect(mapStatusPhaseToRequestPhase('composing')).toBe('composing')
    expect(mapStatusPhaseToRequestPhase('done')).toBe('persisting')
    expect(mapStatusPhaseToRequestPhase('error')).toBe('error')
  })
})
