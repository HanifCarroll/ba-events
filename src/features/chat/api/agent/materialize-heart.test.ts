import { describe, expect, it } from 'vitest'
import { materializeText } from './materialize.ts'

describe('save-control guidance', () => {
  it('describes the visible heart control in English', () => {
    expect(materializeText({ messageKey: 'use_save_control', locale: 'en' })).toContain('heart button')
    expect(materializeText({ messageKey: 'use_unsave_control', locale: 'en' })).toContain('heart button')
  })

  it('describes the visible heart control in Spanish', () => {
    expect(materializeText({ messageKey: 'use_save_control', locale: 'es' })).toContain('corazón')
    expect(materializeText({ messageKey: 'use_unsave_control', locale: 'es' })).toContain('corazón')
  })
})
