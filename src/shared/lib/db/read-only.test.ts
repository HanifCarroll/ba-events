import { describe, expect, it } from 'vitest'
import { isReadOnly, readOnlyResponse } from './read-only.ts'

const frozen = { DB_READ_ONLY: '1' }

describe('DB_READ_ONLY', () => {
  it('is on only for the exact value 1', () => {
    expect(isReadOnly(frozen)).toBe(true)
    for (const env of [{}, { DB_READ_ONLY: '0' }, { DB_READ_ONLY: '' }, { DB_READ_ONLY: 'true' }, undefined, null]) expect(isReadOnly(env)).toBe(false)
  })

  it('changes nothing when unset', () => {
    expect(readOnlyResponse({}, 'POST', '/api/saved', true)).toBeNull()
    expect(readOnlyResponse({}, 'POST', '/_app/remote/abc/addMessage', true)).toBeNull()
  })

  it('refuses signed-in writes with 503 and Retry-After', async () => {
    for (const [method, path] of [['POST', '/api/saved'], ['DELETE', '/api/saved'], ['POST', '/_app/remote/abc/addMessage'],
      ['POST', '/api/chat'], ['POST', '/api/chat/bootstrap'], ['POST', '/api/feedback'], ['POST', '/api/events']]) {
      const response = readOnlyResponse(frozen, method, path, true)
      expect(response?.status, `${method} ${path}`).toBe(503)
      expect(response?.headers.get('Retry-After')).toBe('600')
    }
  })

  it('keeps reads, sign-in, and guest chat working', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(readOnlyResponse(frozen, method, '/api/saved', true)).toBeNull()
    expect(readOnlyResponse(frozen, 'POST', '/api/auth/sign-in/magic-link', false)).toBeNull()
    expect(readOnlyResponse(frozen, 'POST', '/api/auth/sign-out', true)).toBeNull()
    expect(readOnlyResponse(frozen, 'POST', '/_app/remote/abc/getProfile', true)).toBeNull()
    expect(readOnlyResponse(frozen, 'POST', '/_app/remote/abc/signOut', true)).toBeNull()
    expect(readOnlyResponse(frozen, 'POST', '/api/chat', false)).toBeNull()
    expect(readOnlyResponse(frozen, 'POST', '/api/chat/0b0c/stop', false)).toBeNull()
    // Guests still can't write elsewhere: feedback and the admin API are frozen for everyone.
    expect(readOnlyResponse(frozen, 'POST', '/api/feedback', false)?.status).toBe(503)
    expect(readOnlyResponse(frozen, 'POST', '/api/chatty', false)?.status).toBe(503)
  })
})
