import { describe, expect, it } from 'vitest'
import { adaptLegacyToCanonical, deriveLegacyKind, canonicalToRender } from './canonical.ts'
import type { MessageAttachedData } from '#shared/lib/types.ts'

describe('v2 → v3 canonical adapter', () => {
  it('adapts historical visible_content + attachments without rewriting', () => {
    const attached: MessageAttachedData = {
      events: [{ id: 'e1', name: 'Jazz' } as never],
      suggestions: [{ id: 's1', label: 'x', prompt: 'y', type: 'time' }],
      directions: { venueName: 'Niceto', address: 'a', mapsUrl: 'https://maps' },
    }
    const canonical = adaptLegacyToCanonical({ id: 'msg-1', visible_content: 'Here you go', attached_data: attached })
    expect(canonical.requestId).toBe('legacy:msg-1')
    expect(canonical.text).toBe('Here you go')
    expect(canonical.events.map((e) => e.id)).toEqual(['e1'])
    expect(canonical.directions?.venueName).toBe('Niceto')
    expect(canonical.suggestions).toHaveLength(1)
    expect(canonical.provenance.sourceToolCallIds).toEqual([])
    expect(canonical.provenance.origin).toBe('legacy_unknown')
  })

  it('derives legacy kind from attached data', () => {
    expect(deriveLegacyKind({ events: [{ id: 'e1', name: 'X' } as never] }, 'x')).toBe('recommendations')
    expect(deriveLegacyKind({ events: [{ id: 'e1', name: 'X' } as never, { id: 'e2', name: 'Y' } as never] }, 'x')).toBe('recommendations')
    expect(deriveLegacyKind({ directions: { venueName: 'v', address: 'a', mapsUrl: 'm' } }, 'x')).toBe('directions')
    expect(deriveLegacyKind({}, '')).toBe('no_results')
    expect(deriveLegacyKind({}, 'hi')).toBe('out_of_scope')
  })

  it('maps canonical to render fields', () => {
    const canonical = adaptLegacyToCanonical({ id: 'm', visible_content: 'hi', attached_data: { events: [{ id: 'e1', name: 'X' } as never] } })
    const render = canonicalToRender(canonical)
    expect(render.events.map((e) => e.id)).toEqual(['e1'])
    expect(render.directions).toBeNull()
    expect(render.venue).toBeNull()
    expect(render.operations).toEqual([])
  })
})
