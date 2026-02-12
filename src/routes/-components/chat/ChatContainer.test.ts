import { describe, expect, it } from 'vitest'
import {
  assistantMessageHasVisibleContent,
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
    expect(shouldShowLoadingIndicator('submitted', null)).toBe(true)
  })

  it('shows loading during streaming when assistant has no visible content', () => {
    expect(
      shouldShowLoadingIndicator('streaming', {
        content: '',
      })
    ).toBe(true)
  })

  it('hides loading once final assistant content is visible', () => {
    expect(
      shouldShowLoadingIndicator('streaming', {
        content: 'Go to Club 69 tonight.',
      })
    ).toBe(false)
  })
})
