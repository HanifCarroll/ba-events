import { describe, expect, it } from 'vitest'
import { buildMessageRpcPayload } from './messages'

describe('buildMessageRpcPayload', () => {
  it('persists assistant content with visible_content and execution_trace', () => {
    const payload = buildMessageRpcPayload(
      {
        conversationId: 'conv_1',
        parentMessageId: 'user_1',
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
      }
    )

    expect(payload.p_content).toBe('Go to Palermo tonight.')
    expect(payload.p_parent_id).toBe('user_1')
    expect(payload.p_client_message_id).toBe('client-msg-1')
    expect(payload.p_visible_content).toBe('Go to Palermo tonight.')
    expect(payload.p_execution_trace).toHaveLength(1)
    expect(payload.p_response_contract_version).toBe(2)
  })

  it('falls back visible_content to content for legacy callers', () => {
    const payload = buildMessageRpcPayload(
      {
        conversationId: 'conv_2',
        role: 'assistant',
        content: 'Legacy text',
      }
    )

    expect(payload.p_visible_content).toBe('Legacy text')
    expect(payload.p_client_message_id).toBeNull()
    expect(payload.p_execution_trace).toEqual([])
    expect(payload.p_response_contract_version).toBe(2)
  })
})
