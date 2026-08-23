import { describe, expect, it } from 'vitest'
import { getArtworkAspectRatio } from './event-art.ts'

describe('event artwork sizing', () => {
  it.each([
    [940, 1174, '940 / 1174'],
    [1000, 1000, '1000 / 1000'],
    [1280, 720, '1280 / 720'],
  ])('reserves the intrinsic %sx%s ratio without cropping', (width, height, ratio) => {
    expect(getArtworkAspectRatio(width, height)).toBe(ratio)
  })

  it('does not reserve a guessed ratio when metadata is missing', () => {
    expect(getArtworkAspectRatio(null, null)).toBeUndefined()
  })
})
