import { describe, expect, it } from 'vitest'
import { createChatTiming, requestChatTiming, type ChatTimingSample } from './timing.ts'

const requestId = '11111111-1111-4111-8111-111111111111'
describe('chat startup timing', () => {
  it('separates monotonic stage durations from persisted wall-clock admission gaps', () => {
    let clock = 10, wall = 1500
    const rows: ChatTimingSample[] = []
    const timing = createChatTiming({ requestId, phase: 'generate', admittedAtMs: 1000 },
      { now: () => clock, wallNow: () => wall, emit: row => rows.push(row) })
    timing.mark('workflow_dispatch_received')
    clock = 25; wall = 1520; timing.mark('execution_fetch_start')
    clock = 55; wall = 1570; timing.mark('execution_headers')
    expect(rows.map(row => [row.durationMs, row.elapsedMs, row.sinceAdmissionMs])).toEqual([[0, 0, 500], [15, 15, 520], [30, 45, 570]])
    expect(rows.every(row => row.requestId === requestId && row.version === 'chat-timing-v1' && row.phase === 'generate')).toBe(true)
  })

  it('does not let a broken log sink affect the caller', () => {
    const timing = createChatTiming({ requestId, phase: 'ingress' }, { emit: () => { throw new Error('Exporter unavailable') } })
    expect(() => timing.mark('request_entry')).not.toThrow()
  })

  it('reuses the hook timing without logging request data or delivery credentials', () => {
    const samples: ChatTimingSample[] = []
    const timing = createChatTiming({ requestId, phase: 'ingress' }, { emit: row => samples.push(row) })
    const request = new Request('https://baeventos.com/api/chat?private=secret', { method: 'POST',
      headers: { 'x-chat-attempt': requestId, 'x-chat-token': 'private-capability', authorization: 'Bearer private-key' }, body: 'private text' })
    const event = { request, locals: { chatTiming: timing } }
    expect(requestChatTiming(event)).toBe(timing)
    requestChatTiming(event).mark('body_ready')
    expect(Object.keys(samples[0]).sort()).toEqual(['durationMs', 'elapsedMs', 'phase', 'requestId', 'scope', 'stage', 'version'])
    expect(JSON.stringify(samples)).not.toMatch(/private|secret|Bearer/)
    expect(request.headers.get('x-chat-token')).toBe('private-capability')
  })

  it('ignores invalid identifiers and unrelated requests without loading context', () => {
    for (const url of ['https://baeventos.com/api/chat', 'https://baeventos.com/']) {
      const event = { request: new Request(url, { headers: { 'x-chat-attempt': 'sk-private-key' } }),
        get locals(): never { throw new Error('Context must not be loaded') } }
      expect(() => requestChatTiming(event).mark('request_entry')).not.toThrow()
    }
    const rows: unknown[] = []
    createChatTiming({ requestId: 'sk-private-key', phase: 'ingress' }, { emit: row => rows.push(row) }).mark('request_entry')
    expect(rows).toEqual([])
  })

  it('keeps a cross-worker clock anomaly unknown', () => {
    const rows: ChatTimingSample[] = []
    createChatTiming({ requestId, phase: 'generate', admittedAtMs: 2000 }, { wallNow: () => 1000, emit: row => rows.push(row) }).mark('workflow_dispatch_received')
    expect(rows[0].sinceAdmissionMs).toBeNull()
  })
})
