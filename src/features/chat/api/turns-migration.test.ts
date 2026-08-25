import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260825120000_add_chat_turn_execution.sql', import.meta.url),
  'utf8'
)

describe('durable chat turn migration guards', () => {
  it('keeps bootstrap replay immutable and owner-bound', () => {
    expect(migration).toContain('result_turn.user_id <> current_user_id')
    expect(migration).toContain('result_turn.conversation_id <> p_conversation_id')
    expect(migration).toContain('result_turn.user_client_message_id <> p_user_client_message_id')
    expect(migration).toContain('result_turn.assistant_client_message_id <> p_assistant_client_message_id')
    expect(migration).toContain('result_turn.content <> p_content')
    expect(migration).toContain('result_turn.locale <> p_locale')
  })

	it('bounds directly invoked bootstrap inputs', () => {
		expect(migration).toContain('length(p_content) > 2000')
		expect(migration).toContain('length(p_user_client_message_id) NOT BETWEEN 1 AND 128')
		expect(migration).toContain('length(p_assistant_client_message_id) NOT BETWEEN 1 AND 128')
	})

	it('prevents assistant-key substitution and supports explicit failure', () => {
    expect(migration).toContain('result_turn.assistant_client_message_id <> p_assistant_client_message_id')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION fail_chat_turn')
    expect(migration).toContain("status = 'failed'")
    expect(migration).toContain("status = 'interrupted'")
	})

	it('reclaims expired running turns only on explicit retry', () => {
		const runningBranch = migration.indexOf("IF result_turn.status = 'running' AND NOT p_retry")
		expect(runningBranch).toBeGreaterThan(-1)
		expect(migration.indexOf("IF result_turn.status IN ('failed', 'interrupted') AND NOT p_retry")).toBeGreaterThan(runningBranch)
	})
})
