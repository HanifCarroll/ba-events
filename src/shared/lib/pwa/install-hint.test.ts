import { describe, expect, it } from 'vitest'
import { hideInstallHint, recordInstallHintVisit } from './install-hint.ts'

function testStorage() {
	const values = new Map<string, string>()
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value) }
	}
}

function tab(localStorage = testStorage()) {
	return { localStorage, sessionStorage: testStorage() }
}

describe('homepage install hint persistence', () => {
	it('keeps one eligibility decision per tab session, even when another tab visits', () => {
		const first = tab()
		expect(recordInstallHintVisit(first)).toBe(false)
		expect(recordInstallHintVisit(first)).toBe(false)
		const second = tab(first.localStorage)
		expect(recordInstallHintVisit(second)).toBe(true)
		expect(recordInstallHintVisit(second)).toBe(true)
		expect(recordInstallHintVisit(first)).toBe(false)
		expect(recordInstallHintVisit(tab(first.localStorage))).toBe(true)
		expect(recordInstallHintVisit(tab())).toBe(false)
	})

	it('does not offer the hint after dismissal or an installation reported before the second visit', () => {
		const previousVisits = [0, 2]
		for (const visits of previousVisits) {
			const first = tab()
			const second = tab(first.localStorage)
			if (visits) {
				expect(recordInstallHintVisit(first)).toBe(false)
				expect(recordInstallHintVisit(second)).toBe(true)
			}
			hideInstallHint(first)
			expect(recordInstallHintVisit(first)).toBe(false)
			expect(recordInstallHintVisit(second)).toBe(false)
			expect(recordInstallHintVisit(tab(first.localStorage))).toBe(false)
		}
	})

	it('fails closed if storage access or a write is denied', () => {
		const blocked = {
			get localStorage(): never { throw new Error('blocked storage') },
			get sessionStorage(): never { throw new Error('blocked storage') }
		}
		const readOnly = {
			sessionStorage: testStorage(),
			localStorage: {
				getItem: () => '2',
				setItem: () => { throw new Error('read-only storage') }
			}
		}
		for (const browser of [blocked, readOnly]) {
			expect(recordInstallHintVisit(browser)).toBe(false)
			expect(() => hideInstallHint(browser)).not.toThrow()
		}
	})
})
