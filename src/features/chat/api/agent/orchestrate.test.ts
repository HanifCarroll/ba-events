import { describe, expect, it } from 'vitest'
import { orchestrate, type AgentRun } from './orchestrate.ts'
import { orchestrateEffect } from './orchestrate.ts'
import { Effect } from 'effect'
import type { CanonicalChatResponse, ChatEventPayload } from '#shared/lib/types.ts'
import { warmRecommendationFallback } from '#shared/lib/recommendation-framing.ts'
import { createGetDirectionsTool } from '../tools/get-directions.ts'
import type { EventWithVenue } from '#shared/lib/types.ts'

const base = {
  requestId: 'request-1',
  userContext: { userId: null, isAuthenticated: false },
  locale: 'en' as const,
  originalQuery: 'How can I share this event with a friend?',
  priorDisplayedEvents: [],
}

const priorEvent = (id: string, name: string) => ({
  id, name, starts_at: '2026-08-30T20:00:00.000Z', ends_at: null, is_all_day: false,
  time_tba: false, venue_id: null, venue_name: 'Venue', venue_neighborhood: 'Palermo',
  venue_address: null, categories: [], price: null, is_free: true, min_age: null,
  image_url: null, link: null, ticket_url: null, source: 'source', external_id: null,
  status: 'scheduled', location_hidden: false, location_tba: false,
  description_unavailable: false, embedding: undefined, enrichment_status: 'completed',
  enrichment_error: null, enriched_at: null, facets: {}, created_at: '', updated_at: '', saved: null,
}) as unknown as ChatEventPayload

describe('recommendation follow-ups', () => {
  for (const kind of ['search_events', 'get_event_details', 'list_saved_events'] as const) {
    it(`sends complete source descriptions without redundant presentation copies for ${kind}`, async () => {
      const original: ChatEventPayload = { ...priorEvent('original', 'Original-source event'),
        description_en: `Original English ${'source text '.repeat(500)}Final exact source fact.`,
        description_es: 'Texto original completo.', description_display_en: 'Rendered English copy.',
        description_display_es: 'Copia renderizada.', description_summary_en: 'English summary.', description_summary_es: 'Resumen.' }
      const display: ChatEventPayload = { ...original, id: 'display', description_en: null, description_es: null }
      const summary: ChatEventPayload = { ...display, id: 'summary', description_display_en: null, description_display_es: null }
      const events = [original, display, summary]
      let supplied: Array<Record<string, unknown>> = []
      const read = async () => ({ success: true, events, formatted: '{}' })
      const result = await orchestrate({
        ...base,
        priorDisplayedEvents: [{ requestId: 'prior', assistantMessageId: 'home', createdAt: null,
          events: [{ eventId: original.id, displayIndex: 0, name: original.name, saved: null }] }],
        readExecutors: { search: read, eventDetails: read, listSaved: read },
        runAgentFn: async input => {
          const selected = input.tools[kind] as unknown as { execute: (value: unknown, options: unknown) => Promise<{ events: Array<Record<string, unknown>> }> }
          const output = await selected.execute(kind === 'get_event_details' ? { eventRef: 'prior:event_0', purpose: 'recommendation' } : kind === 'search_events' ? { objective: 'search' } : {}, { toolCallId: 'description-read' })
          supplied = output.events
          return { text: 'Here are the available source details.', steps: [{ toolResults: [{ toolCallId: 'description-read', toolName: kind, output }] }], responseId: null }
        },
      })
      expect(supplied[0]).toMatchObject({ description_en: original.description_en, description_es: original.description_es })
      for (const field of ['description_display_en', 'description_display_es', 'description_summary_en', 'description_summary_es']) expect(supplied[0]).not.toHaveProperty(field)
      expect(supplied[1]).toMatchObject({ description_en: null, description_es: null,
        description_display_en: display.description_display_en, description_display_es: display.description_display_es })
      expect(supplied[1]).not.toHaveProperty('description_summary_en')
      expect(supplied[2]).toMatchObject({ description_summary_en: summary.description_summary_en, description_summary_es: summary.description_summary_es })
      expect(supplied[2]).not.toHaveProperty('description_display_en')
      expect(result.canonical.events[0]).toMatchObject({ description_en: original.description_en,
        description_display_en: original.description_display_en, description_summary_en: original.description_summary_en })
    })
  }

  it('passes authoritative prices and source descriptions/links without inferring missing facts', async () => {
    const events: ChatEventPayload[] = [
      { ...priorEvent('unknown', 'Music-sounding title'), price: null, is_free: false, link: null, ticket_url: null,
        description_es: null, description_en: null, description_display_es: null, description_display_en: null,
        description_summary_es: null, description_summary_en: null, description_unavailable: true,
        categories: ['music'], facets: { eventType: ['concert'], genres: [], activities: ['live-music'], vibes: [], audience: [], setting: ['seated'] } },
      { ...priorEvent('zero', 'Zero-price event'), price: 0, is_free: false,
        description_en: 'Exact source description.', link: 'https://source.example.test/event', ticket_url: 'https://tickets.example.test/event' },
    ]
    let supplied: Array<Record<string, unknown>> = []
    const result = await orchestrate({
      ...base,
      readExecutors: { search: async () => ({ success: true, events, formatted: '{}' }) },
      runAgentFn: async input => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<{ events: Array<Record<string, unknown>> }> }
        const output = await search.execute({ objective: 'search' }, { toolCallId: 'source-read' })
        supplied = output.events
        return { text: 'Here are the source details.', steps: [{ toolResults: [{ toolCallId: 'source-read', toolName: 'search_events', output }] }], responseId: null }
      },
    })
    expect(supplied[0]).toMatchObject({ price: null, is_free: false, link: null, ticket_url: null,
      description_en: null, description_es: null, description_summary_en: null, description_unavailable: true })
    expect(supplied[0]).not.toHaveProperty('description_display_en')
    expect(supplied[0]).not.toHaveProperty('facets')
    expect(supplied[1]).toMatchObject({ price: 0, is_free: true, description_en: events[1].description_en,
      link: events[1].link, ticket_url: events[1].ticket_url })
    expect(result.canonical.events[0]).toMatchObject({ price: null, is_free: false, link: null, ticket_url: null })
    expect(result.canonical.events[1]).toMatchObject({ price: 0, link: events[1].link, ticket_url: events[1].ticket_url })
  })

  for (const origin of ['prior', 'pinned'] as const) {
    it(`rechecks event-owned ${origin} venue handles before exposing location details`, async () => {
      const event = { ...priorEvent('event-1', 'Hidden event'), location_hidden: true, venue_id: 'private-venue', venue_address: 'Secret street 123' }
      let venueReads = 0
      const outputs: Array<Record<string, unknown>> = []
      const directions = createGetDirectionsTool({
        getEventWithVenue: async () => event as unknown as EventWithVenue,
        getVenueById: async () => { venueReads++; throw new Error('Unexpected venue fallback') },
      })
      const ref = origin === 'pinned' ? 'pinned_venue' : 'prior:event_0:venue'
      await orchestrate({
        ...base,
        priorDisplayedEvents: [{ requestId: 'prior', assistantMessageId: 'assistant', createdAt: null,
          events: [{ eventId: event.id, displayIndex: 0, name: event.name, saved: null }] }],
        // Simulate an older venue handle whose event has since become private.
        venueByEventId: new Map([[event.id, { venueId: event.venue_id, venueName: event.venue_name }]]),
        pin: origin === 'pinned' ? { requested: true, status: 'resolved', eventId: event.id, venueId: event.venue_id } : undefined,
        readExecutors: {
          eventDetails: async () => ({ success: true, events: [event], formatted: '{}' }),
          directions: (input, context) => directions.execute(input, context),
          venueDetails: async () => { venueReads++; throw new Error('Unexpected venue read') },
        },
        runAgentFn: async input => {
          const toolResults = []
          for (const toolName of ['get_venue_details', 'get_directions']) {
            const tool = input.tools[toolName] as unknown as { execute: (value: unknown, options: unknown) => Promise<Record<string, unknown>> }
            const output = await tool.execute({ venueRef: ref }, { toolCallId: toolName })
            outputs.push(output)
            toolResults.push({ toolCallId: toolName, toolName, output })
          }
          return { text: 'Check the original source for the location.', steps: [{ toolResults }], responseId: null }
        },
      })
      expect(outputs).toHaveLength(2)
      expect(outputs.every(output => output.success === false && output.error === 'location_unavailable')).toBe(true)
      expect(JSON.stringify(outputs)).not.toContain(event.venue_address)
      expect(venueReads).toBe(0)
    })
  }

  for (const kind of ['search_events', 'get_event_details', 'list_saved_events'] as const) {
    it(`keeps hidden addresses out of ${kind} model input, previews and final cards`, async () => {
      const event = { ...priorEvent('event-1', 'Private-location event'),
        venue_id: 'private-venue', venue_address: 'Secret street 123', location_hidden: true }
      let venueReads = 0
      const outputs: Array<Record<string, unknown>> = []
      const previews: string[] = []
      const directions = createGetDirectionsTool({
        getEventWithVenue: async () => event as unknown as EventWithVenue,
        getVenueById: async () => { venueReads++; throw new Error('Unexpected venue fallback') },
      })
      const read = async () => ({ success: true, events: [event], formatted: '{}' })
      const result = await orchestrate({
        ...base,
        priorDisplayedEvents: [{ requestId: 'prior', assistantMessageId: 'assistant', createdAt: null,
          events: [{ eventId: event.id, displayIndex: 0, name: event.name, saved: null }] }],
        onProgress: response => { previews.push(JSON.stringify(response)) },
        readExecutors: { search: read, eventDetails: read, listSaved: read,
          directions: (input, context) => directions.execute(input, context),
          venueDetails: async () => { venueReads++; throw new Error('Unexpected venue read') } },
        runAgentFn: async input => {
          const invoke = async (toolName: string, value: unknown, toolCallId: string) => {
            const tool = input.tools[toolName] as unknown as { execute: (value: unknown, options: unknown) => Promise<Record<string, unknown>> }
            const output = await tool.execute(value, { toolCallId })
            outputs.push(output)
            return { toolCallId, toolName, output }
          }
          const toolResults = [
            await invoke(kind, kind === 'get_event_details' ? { eventRef: 'prior:event_0' } : kind === 'search_events' ? { objective: 'search' } : {}, 'private-read'),
            await invoke('get_venue_details', { venueRef: 'private-read:venue_0' }, 'private-venue-read'),
            await invoke('get_directions', { eventRef: 'private-read:event_0' }, 'private-directions'),
          ]
          return { text: 'The event location is hidden.', steps: [{ toolResults }], responseId: null }
        },
      })
      expect((outputs[0].events as Array<Record<string, unknown>>)[0]).toMatchObject({ venue_address: null, location_hidden: true })
      expect((outputs[0].events as Array<Record<string, unknown>>)[0]).not.toHaveProperty('venueRef')
      expect(outputs[1]).toMatchObject({ success: false, error: 'unknown_venue_ref' })
      expect(outputs[2]).toMatchObject({ success: false, error: 'location_unavailable' })
      if (kind === 'get_event_details') expect(result.canonical.events).toEqual([])
      else expect(result.canonical.events[0].venue_address).toBeNull()
      expect(result.canonical.directions).toBeNull()
      expect(previews.length).toBeGreaterThan(0)
      expect([...previews, JSON.stringify(outputs), JSON.stringify(result.canonical)].join('\n')).not.toContain(event.venue_address)
      expect(venueReads).toBe(0)
    })
  }

  for (const timeTba of [true, false]) {
    it(`passes ${timeTba ? 'only the known date' : 'verified local times'} to the model`, async () => {
      const event = {
        ...priorEvent('dated-event', 'Source event'),
        starts_at: '2026-10-14T01:00:00.000Z',
        ends_at: '2026-10-14T04:00:00.000Z',
        time_tba: timeTba,
      }
      let modelEvent: Record<string, unknown> | undefined
      const result = await orchestrate({
        ...base,
        readExecutors: { search: async () => ({ success: true, events: [event], formatted: '{}' }) },
        runAgentFn: async (input) => {
          const search = input.tools.search_events as unknown as {
            execute: (value: unknown, options: unknown) => Promise<{ events: Array<Record<string, unknown>> }>
          }
          const output = await search.execute({ objective: 'search' }, { toolCallId: 'date-read' })
          modelEvent = output.events[0]
          return { text: 'Here are the available details.', steps: [{ toolResults: [{
            toolCallId: 'date-read', toolName: 'search_events', output,
          }] }], responseId: null }
        },
      })
      expect(modelEvent).toMatchObject({
        starts_at: timeTba ? '2026-10-13' : '2026-10-13 22:00 (America/Argentina/Buenos_Aires)',
        ends_at: timeTba ? null : '2026-10-14 01:00 (America/Argentina/Buenos_Aires)',
        time_tba: timeTba,
      })
      // Cards retain source timestamps and the explicit unknown-time flag.
      expect(result.canonical.events[0]).toMatchObject({
        starts_at: event.starts_at, ends_at: event.ends_at, time_tba: timeTba,
      })
    })
  }

  it('exposes only the declared read and framing tools, including for save requests', async () => {
    await orchestrate({
      ...base, originalQuery: 'Save the second event',
      runAgentFn: async (input) => {
        expect(Object.keys(input.tools).sort()).toEqual([
          'ask_clarification', 'get_directions', 'get_event_details',
          'get_venue_details', 'list_saved_events', 'recommendations_mismatch', 'search_events',
        ])
        return { text: 'Use the event save button.', steps: [], responseId: null }
      },
    })
  })

  for (const parallel of [false, true]) {
    it(`rejects excess ${parallel ? 'parallel' : 'sequential'} tool calls before invoking the business reader`, async () => {
      let businessReads = 0
      const outputs: Array<{ success?: boolean; error?: string }> = []
      const result = await orchestrate({
        ...base,
        priorDisplayedEvents: [{ requestId: 'prior', assistantMessageId: 'assistant', createdAt: null,
          events: [{ eventId: 'event-1', displayIndex: 0, name: 'Verified event', saved: null }] }],
        readExecutors: { eventDetails: async () => {
          businessReads++
          await Promise.resolve()
          return { success: true, events: [priorEvent('event-1', 'Verified event')], formatted: '{}' }
        } },
        runAgentFn: async (input) => {
          const details = input.tools.get_event_details as unknown as {
            execute: (value: unknown, options: unknown) => Promise<{ success?: boolean; error?: string }>
          }
          const read = (index: number) => details.execute(
            { eventRef: 'prior:event_0', purpose: 'details' }, { toolCallId: `bounded-${index}` },
          )
          if (parallel) outputs.push(...await Promise.all(Array.from({ length: 10 }, (_, index) => read(index))))
          else for (let index = 0; index < 10; index++) outputs.push(await read(index))
          return { text: 'Here are the verified details.', steps: [{ toolResults: outputs.map((output, index) => ({
            toolCallId: `bounded-${index}`, toolName: 'get_event_details', output,
          })) }], responseId: null }
        },
      })
      expect(businessReads).toBe(8)
      expect(outputs.slice(0, 8).every(output => output.success)).toBe(true)
      expect(outputs.slice(8)).toEqual([
        expect.objectContaining({ success: false, error: 'tool_call_limit' }),
        expect.objectContaining({ success: false, error: 'tool_call_limit' }),
      ])
      expect(result.canonical.events).toEqual([])
      expect(result.reads.filter(read => read.success)).toHaveLength(8)
    })
  }

  it('aborts a real tool deadline, keeps earlier reads and ignores a late completion', async () => {
    let received: AbortSignal | undefined
    let finishLateRead: () => void = () => {}
    let toolError: unknown
    const previews: string[][] = []
    const result = await orchestrate({
      ...base, originalQuery: 'Find events',
      onProgress: (preview) => previews.push(preview.events.map((event) => event.id)),
      readExecutors: {
        search: async () => ({ success: true, events: [priorEvent('kept-event', 'Kept event')], formatted: '{}' }),
        eventDetails: async (_input, context) => {
          received = context.abortSignal
          return new Promise((resolve) => {
            finishLateRead = () => resolve({ success: true, events: [priorEvent('late-event', 'Late event')], formatted: '{}' })
          })
        },
      },
      runAgentFn: async (input) => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<{ error?: unknown }> }
        await search.execute({ objective: 'search', query: 'events', limit: 1 }, { toolCallId: 'kept-read' })
        toolError = (await details.execute({ eventRef: 'kept-read:event_0', purpose: 'details' }, { toolCallId: 'late-read' })).error
        throw new Error('Final generation unavailable')
      },
    })
    expect(received?.aborted).toBe(true)
    expect(toolError).toBe('tool_timeout')
    expect(result.canonical.events.map((event) => event.id)).toEqual(['kept-event'])
    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    const previewCount = previews.length
    finishLateRead()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(previews).toHaveLength(previewCount)
    expect(previews.flat()).not.toContain('late-event')
  }, 12_000)

  it('propagates SDK step cancellation to an in-flight read and excludes its late result', async () => {
    const sdk = new AbortController()
    let readSignal: AbortSignal | undefined
    const previews: unknown[] = []
    const result = await orchestrate({
      ...base, onProgress: (preview) => previews.push(preview),
      readExecutors: { search: async (_input, context) => {
        readSignal = context.abortSignal
        sdk.abort()
        return { success: true, events: [priorEvent('late', 'Late event')], formatted: '{}' }
      } },
      runAgentFn: async (input) => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await search.execute({ objective: 'search' }, { toolCallId: 'sdk-cancelled', abortSignal: sdk.signal })
        return { text: 'Late reply', steps: [], responseId: null }
      },
    })
    expect(readSignal?.aborted).toBe(true)
    expect(result.canonical.events).toEqual([])
    expect(previews).toEqual([])
  })

  it('interrupting the owning Effect aborts its runner and pending read', async () => {
    const owner = new AbortController()
    let started: () => void = () => {}
    const ready = new Promise<void>((resolve) => { started = resolve })
    let readSignal: AbortSignal | undefined
    let runnerSignal: AbortSignal | undefined
    const previews: unknown[] = []
    const running = Effect.runPromise(orchestrateEffect({
      ...base, onProgress: (preview) => previews.push(preview),
      readExecutors: { search: async (_input, context) => {
        readSignal = context.abortSignal
        started()
        return new Promise(() => {})
      } },
      runAgentFn: async (input) => {
        runnerSignal = input.abortSignal
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await search.execute({ objective: 'search' }, { toolCallId: 'interrupted' })
        return { text: 'Late reply', steps: [], responseId: null }
      },
    }), { signal: owner.signal })
    const outcome = running.then(() => ({ rejected: false }), () => ({ rejected: true }))
    await ready
    owner.abort()
    expect((await outcome).rejected).toBe(true)
    expect(readSignal?.aborted).toBe(true)
    expect(runnerSignal?.aborted).toBe(true)
    expect(previews).toEqual([])
  })

  it('passes producer cancellation to the actual read executor', async () => {
    const controller = new AbortController()
    let readSignal: AbortSignal | undefined
    await orchestrate({
      ...base, abortSignal: controller.signal,
      readExecutors: { search: async (_input, context) => {
        readSignal = (context as { abortSignal?: AbortSignal }).abortSignal
        controller.abort()
        return { success: true, events: [priorEvent('late', 'Late event')], formatted: '{}' }
      } },
      runAgentFn: async (input) => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await search.execute({ objective: 'search', query: 'events' }, { toolCallId: 'cancelled-read' })
        return { text: 'Late reply', steps: [], responseId: null }
      },
    })
    expect(readSignal).toBeDefined()
    expect(readSignal?.aborted).toBe(true)
  })

  it('shows search cards immediately without placeholder prose, then publishes validated framing', async () => {
    const events = [priorEvent('one', 'First event'), priorEvent('two', 'Second event'), priorEvent('three', 'Third event')]
    const previews: CanonicalChatResponse[] = []
    const text = [
      "ACK: Sure — here's what's on for live music tonight.",
      'REASON_1: A live performance.',
      'REASON_2: Another live performance.',
      'REASON_3: A session showcasing singers.',
      'NEXT: Want directions to any of these, or details on tickets?',
    ].join('\n')
    const result = await orchestrate({
      ...base, originalQuery: 'Find live music tonight',
      readExecutors: { search: async () => ({ success: true, events, formatted: '{}' }) },
      onProgress: response => previews.push(response),
      runAgentFn: async input => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await search.execute({ objective: 'search', query: 'live music' }, { toolCallId: 'search' })
        expect(previews.at(-1)?.events.map(event => event.id)).toEqual(['one', 'two', 'three'])
        for (const partial of ['', 'ACK:', text.split('\n')[0], text.slice(0, text.indexOf('NEXT:'))]) input.onText?.(partial)
        expect(previews.every(preview => preview.text === '' && preview.framing === undefined)).toBe(true)
        input.onText?.(text)
        expect(previews.at(-1)?.text).toBe("Sure — here's what's on for live music tonight.")
        return { text, steps: [{ toolResults: [{ toolCallId: 'search', toolName: 'search_events' }] }], responseId: null }
      },
    })
    expect(previews.every(preview => preview.events.length === 3)).toBe(true)
    expect(previews.at(-1)?.framing).toEqual(result.canonical.framing)
    expect(result.canonical.events.map(event => event.recommendation_reason)).toEqual([
      'A live performance.', 'Another live performance.', 'A session showcasing singers.',
    ])
  })

  for (const ending of ['invalid framing', 'model failure'] as const) {
    it(`reserves fallback framing for completion after ${ending}`, async () => {
      const previews: CanonicalChatResponse[] = []
      const result = await orchestrate({
        ...base, originalQuery: 'Find live music tonight',
        readExecutors: { search: async () => ({ success: true, events: [priorEvent('one', 'First event')], formatted: '{}' }) },
        onProgress: response => previews.push(response),
        runAgentFn: async input => {
          const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
          await search.execute({ objective: 'search', query: 'live music' }, { toolCallId: 'search' })
          input.onText?.('ACK: Incomplete introduction')
          if (ending === 'model failure') throw new Error('Simulated model failure')
          return { text: 'Unstructured response', steps: [{ toolResults: [{ toolCallId: 'search', toolName: 'search_events' }] }], responseId: null }
        },
      })
      expect(previews.length).toBeGreaterThan(0)
      expect(previews.every(preview => preview.text === '' && preview.framing === undefined && preview.events.length === 1)).toBe(true)
      expect(result.canonical.framing).toEqual(warmRecommendationFallback('en', 1))
      expect(result.canonical.text).toBe(result.canonical.framing?.acknowledgement)
      expect(result.canonical.events.map(event => event.id)).toEqual(['one'])
      expect(result.canonical.provenance.fallbackUsed).toBe(ending === 'model failure')
    })
  }

  it('streams grounded follow-up prose without publishing a repeated card', async () => {
    const previews: Array<{ text: string; ids: string[] }> = []
    let finalReturned = false
    const result = await orchestrate({
      ...base, originalQuery: 'Tell me about this event',
      priorDisplayedEvents: [{ requestId: 'prior', assistantMessageId: 'assistant', createdAt: null,
        events: [{ eventId: 'verified-id', displayIndex: 0, name: 'Verified event', saved: null }] }],
      readExecutors: { eventDetails: async () => ({ success: true, events: [priorEvent('verified-id', 'Verified event')], formatted: '{}' }) },
      onProgress: (response) => { expect(finalReturned).toBe(false); previews.push({ text: response.text, ids: response.events.map(({ id }) => id) }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'prior:event_0', purpose: 'details' }, { toolCallId: 'detail' })
        expect(previews.every(({ ids }) => ids.length === 0)).toBe(true)
        input.onText?.('Here is')
        input.onText?.('Here is the event. Invented event id: forged-id')
        finalReturned = true
        return { text: 'Here is the event.', steps: [{ toolResults: [{ toolCallId: 'detail', toolName: 'get_event_details' }] }], responseId: null }
      },
    })
    expect(previews.every(({ ids }) => ids.every((id) => id === 'verified-id'))).toBe(true)
    expect(previews.some(({ text }) => text === 'Here is')).toBe(true)
    expect(result.canonical.events).toEqual([])
    expect(result.canonical.text).toBe('Here is the event.')
  })

  for (const purpose of [undefined, 'details', 'save', 'unsave', 'recommendation'] as const) {
    it(`keeps follow-up facts and provenance with purpose ${purpose ?? 'omitted'}`, async () => {
      const previews: string[][] = []
      const result = await orchestrate({
        ...base, originalQuery: 'Does it look fun?',
        priorDisplayedEvents: [{ requestId: 'prior', assistantMessageId: 'assistant', createdAt: null,
          events: [{ eventId: 'event-1', displayIndex: 0, name: 'Verified event', saved: null }] }],
        readExecutors: { eventDetails: async () => ({ success: true,
          events: [{ ...priorEvent('event-1', 'Verified event'), description_en: 'Live jazz with a dance floor.' }], formatted: '{}' }) },
        onProgress: (response) => previews.push(response.events.map(({ id }) => id)),
        runAgentFn: async (input) => {
          const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<{ events: Array<Record<string, unknown>> }> }
          const output = await details.execute({ eventRef: 'prior:event_0', ...(purpose ? { purpose } : {}) }, { toolCallId: 'detail' })
          expect(output.events[0]?.description_en).toBe('Live jazz with a dance floor.')
          input.onText?.('The source lists live jazz and a dance floor.')
          return { text: 'The source lists live jazz and a dance floor.', steps: [{ toolResults: [{ toolCallId: 'detail', toolName: 'get_event_details' }] }], responseId: null }
        },
      })
      const expectedIds = purpose === 'save' || purpose === 'unsave' ? ['event-1'] : []
      expect(result.canonical.events.map(({ id }) => id)).toEqual(expectedIds)
      expect(previews.length).toBeGreaterThan(0)
      expect(previews.every((ids) => JSON.stringify(ids) === JSON.stringify(expectedIds))).toBe(true)
      expect(result.canonical.provenance.sourceToolCallIds).toEqual(['detail'])
      expect(result.reads[0]?.eventIds).toEqual(['event-1'])
      expect(result.canonical.provenance.fallbackUsed).toBe(false)
    })
  }

  it('keeps the first chat card for an event referenced from home suggestions', async () => {
    const result = await orchestrate({
      ...base, originalQuery: 'Tell me about this event',
      priorDisplayedEvents: [{ requestId: 'home', assistantMessageId: 'home', createdAt: null,
        events: [{ eventId: 'event-1', displayIndex: 0, name: 'Verified event', saved: null }] }],
      readExecutors: { eventDetails: async () => ({ success: true, events: [priorEvent('event-1', 'Verified event')], formatted: '{}' }) },
      runAgentFn: async (input) => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'home:event_0', purpose: 'details' }, { toolCallId: 'detail' })
        return { text: 'Here are the details.', steps: [{ toolResults: [{ toolCallId: 'detail', toolName: 'get_event_details' }] }], responseId: null }
      },
    })
    expect(result.canonical.events.map(({ id }) => id)).toEqual(['event-1'])
  })

  it('does not repeat a prior card when generation fails after a successful detail read', async () => {
    const result = await orchestrate({
      ...base, priorDisplayedEvents: [{ requestId: 'prior', assistantMessageId: 'assistant', createdAt: null,
        events: [{ eventId: 'event-1', displayIndex: 0, name: 'Verified event', saved: null }] }],
      readExecutors: { eventDetails: async () => ({ success: true, events: [priorEvent('event-1', 'Verified event')], formatted: '{}' }) },
      runAgentFn: async (input) => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'prior:event_0' }, { toolCallId: 'detail' })
        throw new Error('Final generation failed')
      },
    })
    expect(result.canonical.events).toEqual([])
    expect(result.canonical.provenance).toMatchObject({ sourceToolCallIds: ['detail'], fallbackUsed: true })
    expect(result.canonical.text.length).toBeGreaterThan(0)
  })

  it('does not publish a tool result after cancellation', async () => {
    const controller = new AbortController(); const previews: unknown[] = []
    await orchestrate({ ...base, abortSignal: controller.signal, onProgress: (response) => previews.push(response),
      runAgentFn: async (input) => { controller.abort(); input.onText?.('Late text'); throw new Error('Aborted') } })
    expect(previews).toEqual([])
  })
  it('signals a mismatch when inspected descriptions do not support the requested criterion', async () => {
    const result = await orchestrate({
      ...base,
      originalQuery: 'Which one suits business owners?',
      priorDisplayedEvents: [{
        requestId: 'search-1', assistantMessageId: 'assistant-1', createdAt: null,
        events: [{ eventId: 'event-1', displayIndex: 0, name: 'EA Summit', saved: null }],
      }],
      readExecutors: { eventDetails: async ({ eventId }) => ({
        success: true,
        events: [{ ...priorEvent(eventId, 'EA Summit'), description_en: 'Talks and discussions about effective altruism.', facets: { eventType: [], genres: [], activities: [], vibes: [], audience: ['networking'], setting: [] } }],
        formatted: '{}',
      }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        const mismatch = input.tools.recommendations_mismatch as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'search-1:event_0', purpose: 'details' }, { toolCallId: 'detail-1' })
        await mismatch.execute({ reason: 'EA Summit covers effective altruism talks, but its source description does not mention business networking.' }, { toolCallId: 'mismatch-1' })
        return {
          text: 'I could not find a clear match.',
          steps: [{ toolResults: [
            { toolCallId: 'detail-1', toolName: 'get_event_details' },
            { toolCallId: 'mismatch-1', toolName: 'recommendations_mismatch' },
          ] }],
          responseId: null,
        }
      },
    })
    expect(result.canonical.messageKey).toBe('recommendations_mismatch')
    expect(result.canonical.text).toBe('EA Summit covers effective altruism talks, but its source description does not mention business networking.')
    expect(result.canonical.events).toEqual([])
  })

  it('rejects invalid or uninspected mismatch signals', async () => {
    const outputs: Array<{ success?: boolean; error?: string }> = []
    await orchestrate({
      ...base,
      originalQuery: 'Which one suits business owners?',
      runAgentFn: async (input): Promise<AgentRun> => {
        const mismatch = input.tools.recommendations_mismatch as unknown as { execute: (value: unknown, options: unknown) => Promise<{ success?: boolean; error?: string }> }
        outputs.push(await mismatch.execute({ reason: 'See https://example.com' }, { toolCallId: 'mismatch-invalid' }))
        outputs.push(await mismatch.execute({ reason: 'No inspected option supports this criterion.' }, { toolCallId: 'mismatch-uninspected' }))
        return { text: 'No clear match.', steps: [], responseId: null }
      },
    })
    expect(outputs.map(({ success, error }) => ({ success, error }))).toEqual([
      { success: false, error: 'invalid_recommendation_reason' },
      { success: false, error: 'recommendations_mismatch_requires_inspection' },
    ])
  })

  it('uses the final recommendation detail read without repeating its card and preserves model prose', async () => {
    const calls: string[] = []
    const result = await orchestrate({
      ...base,
      originalQuery: 'Which do you recommend most?',
      priorDisplayedEvents: [{
        requestId: 'search-1', assistantMessageId: 'assistant-1', createdAt: null,
        events: [
          { eventId: 'event-1', displayIndex: 0, name: 'First', saved: null },
          { eventId: 'event-2', displayIndex: 1, name: 'Second', saved: null },
        ],
      }],
      readExecutors: { eventDetails: async ({ eventId }) => ({
        success: true, events: [priorEvent(eventId, eventId === 'event-2' ? 'Second' : 'First')], formatted: '{}',
      }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'search-1:event_0', purpose: 'details' }, { toolCallId: 'detail-1' })
        await details.execute({ eventRef: 'search-1:event_1', purpose: 'recommendation' }, { toolCallId: 'detail-2' })
        calls.push('compared')
        return {
          text: 'REASON_1: This fits your request for a focused recommendation.',
          steps: [{ toolResults: [
            { toolCallId: 'detail-1', toolName: 'get_event_details' },
            { toolCallId: 'detail-2', toolName: 'get_event_details' },
          ] }],
          responseId: null,
        }
      },
    })
    expect(calls).toEqual(['compared'])
    expect(result.canonical.messageKey).toBe('recommendations_pick')
    expect(result.canonical.text).toBe('This fits your request for a focused recommendation.')
    expect(result.canonical.events).toEqual([])
    expect(result.reads.findLast(read => read.toolName === 'get_event_details')?.eventIds).toEqual(['event-2'])
  })

  it('keeps facets in canonical events but not in model-facing search output', async () => {
    let modelOutput: { events?: Array<Record<string, unknown>> } | undefined
    const result = await orchestrate({
      ...base,
      originalQuery: 'Find events',
      readExecutors: { search: async () => ({
        success: true,
        events: [{ ...priorEvent('event-1', 'Business Networking'), facets: { eventType: [], genres: [], activities: [], vibes: [], audience: ['networking'], setting: [] } }],
        formatted: '{}',
      }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<Record<string, unknown>> }
        modelOutput = await search.execute({ objective: 'search', query: 'events', limit: 1 }, { toolCallId: 'search-1' })
        return { text: 'Here is one option.', steps: [{ toolResults: [{ toolCallId: 'search-1', toolName: 'search_events' }] }], responseId: null }
      },
    })
    expect(modelOutput?.events?.[0]).not.toHaveProperty('facets')
    expect(result.canonical.events[0]?.facets).toEqual({ eventType: [], genres: [], activities: [], vibes: [], audience: ['networking'], setting: [] })
  })

  it('picks an event when its source description explicitly supports business networking', async () => {
    const result = await orchestrate({
      ...base,
      originalQuery: 'Which suits business owners?',
      priorDisplayedEvents: [{ requestId: 'search-1', assistantMessageId: 'assistant-1', createdAt: null, events: [{ eventId: 'event-1', displayIndex: 0, name: 'Business Mixer', saved: null }] }],
      readExecutors: { eventDetails: async ({ eventId }) => ({ success: true, events: [{ ...priorEvent(eventId, 'Business Mixer'), description_en: 'A business networking mixer for local owners.' }], formatted: '{}' }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'search-1:event_0', purpose: 'recommendation' }, { toolCallId: 'detail-1' })
        return { text: 'REASON_1: The description explicitly mentions business networking.', steps: [{ toolResults: [{ toolCallId: 'detail-1', toolName: 'get_event_details' }] }], responseId: null }
      },
    })
    expect(result.canonical.messageKey).toBe('recommendations_pick')
    expect(result.canonical.events).toEqual([])
    expect(result.canonical.text).toBe('The description explicitly mentions business networking.')
    expect(result.reads[0]?.eventIds).toEqual(['event-1'])
  })
})

describe('share guidance semantics', () => {
  it('marks explicit English and Spanish how-to requests with the semantic key', async () => {
    for (const [locale, originalQuery] of [
      ['en', 'How can I share this event with a friend?'],
      ['es', '¿Cómo comparto este evento con un amigo?'],
    ] as const) {
      const result = await orchestrate({
        ...base,
        locale,
        originalQuery,
        runAgentFn: async () => ({
          text: 'Use the share button on the event card.',
          steps: [],
          responseId: null,
        }),
      })
      expect(result.canonical.messageKey).toBe('share_guidance')
    }
  })

  it('does not relabel a real event search that mentions sharing', async () => {
    const result = await orchestrate({
      ...base,
      originalQuery: 'Find events I can share with kids',
      runAgentFn: async () => ({ text: 'Here are some events.', steps: [], responseId: null }),
    })

    expect(result.canonical.messageKey).not.toBe('share_guidance')
  })
})
