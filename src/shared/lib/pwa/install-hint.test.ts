import { describe, expect, it } from 'vitest'
import { hideInstallHint, preserveInstallHintVisit, recordInstallHintVisit } from './install-hint.ts'

function testStorage() {
	const values = new Map<string, string>()
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value) },
		removeItem: (key: string) => { values.delete(key) }
	}
}

function testBrowser() {
	return { localStorage: testStorage(), sessionStorage: testStorage() }
}

describe('homepage install hint persistence', () => {
	it('keeps the first visit quiet and qualifies on the second and later visits', () => {
		const browser = testBrowser()
		expect(recordInstallHintVisit(browser)).toBe(false)
		expect(recordInstallHintVisit(browser)).toBe(true)
		expect(recordInstallHintVisit(browser)).toBe(true)
		expect(recordInstallHintVisit(testBrowser())).toBe(false)
	})

	it('preserves the current visit through a locale reload without skipping the next real visit', () => {
		const browser = testBrowser()
		expect(recordInstallHintVisit(browser)).toBe(false)
		preserveInstallHintVisit(browser)
		expect(recordInstallHintVisit(browser)).toBe(false)
		expect(recordInstallHintVisit(browser)).toBe(true)
		preserveInstallHintVisit(browser)
		expect(recordInstallHintVisit(browser)).toBe(true)
	})

	it('does not count desktop entries or carry their locale reload marker into a phone visit', () => {
		const browser = testBrowser()
		preserveInstallHintVisit(browser)
		expect(recordInstallHintVisit(browser, false)).toBe(false)
		expect(recordInstallHintVisit(browser)).toBe(false)
		expect(recordInstallHintVisit(browser)).toBe(true)
	})

	it('does not offer the hint after dismissal or an installation reported before the second visit', () => {
		const previousVisits = [0, 2]
		for (const visits of previousVisits) {
			const browser = testBrowser()
			for (let i = 0; i < visits; i++) recordInstallHintVisit(browser)
			hideInstallHint(browser)
			expect(recordInstallHintVisit(browser)).toBe(false)
			expect(recordInstallHintVisit(browser)).toBe(false)
			expect(recordInstallHintVisit(browser)).toBe(false)
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
			expect(() => preserveInstallHintVisit(browser)).not.toThrow()
		}
	})
})
