import { expect, it } from 'vitest'
import { formatGuestDebugMessages } from './guest-chat-debug.ts'

it('prints the input, matched result, coverage, stored time, and canonical response of each assistant turn', () => {
  const coverage = { totalMatches: 35, searchedTo: '2026-11-25T09:00:00.000Z' }
  const suggestions = [{ id: 'show-alternatives', label: 'Show alternatives' }]
  const searchContext = { input: { timeFilter: 'today' } }
  const output = formatGuestDebugMessages([
    { role: 'assistant', parts: [{ type: 'text', text: 'Earlier response.' }] },
    {
      role: 'assistant',
      parts: [{ type: 'data-response', data: { events: [{ name: 'Synthetic show' }], suggestions, searchContext } }],
      executionTrace: [{
        stepIndex: 0,
        toolCalls: [{ toolCallId: 'search', toolName: 'search_events', input: { timeFilter: 'today' } },
          { toolCallId: 'failure', toolName: 'get_event_details' }],
        toolResults: [
          { toolCallId: 'failure', success: false, output: { error: 'unknown_event_ref' } },
          { toolCallId: 'search', success: true, output: {
            events: [{ name: 'Synthetic show', starts_at: '2026-11-24T03:00:00.000Z', time_tba: true }],
            metadata: { searchMode: 'filter_only', totalMatches: 4, coverage },
          } },
        ],
      }],
    },
  ]).join('\n')

  expect(output).toContain('executionTrace: (not recorded)')
  expect(output).toContain('search_events input={"timeFilter":"today"}')
  expect(output).toContain('success=true resultCount=1')
  expect(output).toContain(`searchMode=filter_only totalMatches=4 coverage=${JSON.stringify(coverage)}`)
  expect(output).toContain('"Synthetic show" starts_at=2026-11-24T03:00:00.000Z time_tba=true')
  expect(output).toContain('success=false resultCount=0 error=unknown_event_ref')
  expect(output).toContain('response events: ["Synthetic show"]')
  expect(output).toContain(`suggestions: ${JSON.stringify(suggestions)}`)
  expect(output).toContain(`searchContext: ${JSON.stringify(searchContext)}`)
})
