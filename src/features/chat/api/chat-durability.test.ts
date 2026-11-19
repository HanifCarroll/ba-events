import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = readFileSync(new URL('./execute.server.ts', import.meta.url), 'utf8')

describe('durable chat turn guardrails', () => {
	 it('claims before building authenticated query or history inputs', () => {
		expect(route.indexOf('authoritativeTurn = await Effect.runPromise(claimChatTurnEffect')).toBeLessThan(
			route.indexOf('getLastUserQuery(uiMessages)')
		)
		expect(route).toContain("authoritativeTurn.status === 'completed'")
		expect(route).toContain('if (replayAssistant)')
		expect(route.indexOf('if (replayAssistant)')).toBeLessThan(route.indexOf('runSharedChatTurnEffect({'))
	})
})
