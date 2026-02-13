import { describe, expect, it } from 'vitest'
import { buildMessageInsertPayload } from './messages'

describe('buildMessageInsertPayload', () => {
  it('persists assistant content with visible_content and execution_trace', () => {
    const payload = buildMessageInsertPayload(
      {
        conversationId: 'conv_1',
        role: 'assistant',
        clientMessageId: 'client-msg-1',
        content: 'Go to Palermo tonight.',
        visibleContent: 'Go to Palermo tonight.',
        executionTrace: [
          {
            stepIndex: 0,
            stepType: 'tool-result',
            text: 'Go to Palermo tonight.',
            finishReason: 'stop',
            toolCalls: [],
            toolResults: [],
          },
        ],
        responseContractVersion: 2,
      },
      5
    )

    expect(payload.content).toBe('Go to Palermo tonight.')
    expect(payload.client_message_id).toBe('client-msg-1')
    expect(payload.visible_content).toBe('Go to Palermo tonight.')
    expect(payload.execution_trace).toHaveLength(1)
    expect(payload.response_contract_version).toBe(2)
    expect(payload.sequence_number).toBe(5)
  })

  it('falls back visible_content to content for legacy callers', () => {
    const payload = buildMessageInsertPayload(
      {
        conversationId: 'conv_2',
        role: 'assistant',
        content: 'Legacy text',
      },
      0
    )

    expect(payload.visible_content).toBe('Legacy text')
    expect(payload.client_message_id).toBeNull()
    expect(payload.execution_trace).toEqual([])
    expect(payload.response_contract_version).toBe(2)
  })
})
