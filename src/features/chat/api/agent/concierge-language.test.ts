import { describe, expect, it } from 'vitest'
import { detectReplyLanguage } from '../../../../../evals/concierge/language.ts'

describe('concierge reply language grading', () => {
  it('recognizes the recorded short Spanish reply without accent or stopword clues', () => {
    expect(detectReplyLanguage('Dale, buscamos noches gratis por Palermo y aparecieron tres opciones.')).toBe('es')
  })

  it('recognizes English replies and Spanish replies containing English event names', () => {
    expect(detectReplyLanguage('Here are three free events in Palermo for tonight.')).toBe('en')
    expect(detectReplyLanguage('Estas son las opciones para esta noche, incluyendo Business Networking y Jazz Night.')).toBe('es')
  })

  it('keeps insufficient text and scripts outside the bilingual detector unknown', () => {
    expect(detectReplyLanguage('')).toBe('unknown')
    expect(detectReplyLanguage('Jazz')).toBe('unknown')
    expect(detectReplyLanguage('这是今天晚上的活动列表，请选择你感兴趣的活动。')).toBe('unknown')
  })
})
