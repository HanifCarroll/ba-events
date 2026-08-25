import { describe, expect, it, vi } from 'vitest'
import { installState, promptInstall } from './install.svelte'
import type { BeforeInstallPromptEvent } from './install'
import { isIosDevice, isStandalone } from './install'

describe('PWA install platform detection', () => {
	it('recognizes iPhone, iPad, and iPad desktop user agents', () => {
		expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
		expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true)
		expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true)
		expect(isIosDevice('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 0)).toBe(false)
	})

	it('treats either standalone signal as installed', () => {
		expect(isStandalone(true)).toBe(true)
		expect(isStandalone(false, true)).toBe(true)
		expect(isStandalone(false, false)).toBe(false)
	})

	it('clears the deferred prompt after the user chooses', async () => {
		const prompt = vi.fn(async () => {})
		installState.deferredPrompt = {
			preventDefault: () => {},
			prompt,
			userChoice: Promise.resolve({ outcome: 'dismissed' })
		} as unknown as BeforeInstallPromptEvent

		await promptInstall()

		expect(prompt).toHaveBeenCalledOnce()
		expect(installState.deferredPrompt).toBeNull()
	})
})
