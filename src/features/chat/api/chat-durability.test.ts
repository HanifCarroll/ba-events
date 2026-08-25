import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = readFileSync(new URL('../../../routes/api/chat/+server.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../../supabase/migrations/20260825120000_add_chat_turn_execution.sql', import.meta.url), 'utf8')

describe('durable chat turn guardrails', () => {
	 it('claims before building authenticated query or history inputs', () => {
		expect(route.indexOf('authoritativeTurn = await claimChatTurn')).toBeLessThan(
			route.indexOf('getLastUserQuery(uiMessages)')
		)
		expect(route).toContain("authoritativeTurn.status === 'completed'")
		expect(route).toContain('if (replayAssistant)')
		expect(route.indexOf('if (replayAssistant)')).toBeLessThan(route.indexOf('runSharedChatTurn({'))
	})

	it('does not let completion substitute a different assistant client id', () => {
		expect(migration).toContain('result_turn.assistant_client_message_id <> p_assistant_client_message_id')
		expect(migration).toContain('CREATE OR REPLACE FUNCTION fail_chat_turn')
		expect(migration).toContain("status = 'interrupted'")
	})
})
