import { describe, expect, it, vi } from 'vitest'
import { createInstallController } from './install.machine.ts'
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

	it('consumes a prompt once while waiting for the choice', async () => {
		let resolveChoice!: (choice: { outcome: 'accepted' | 'dismissed' }) => void
		const prompt = vi.fn(async () => {})
		const controller = createInstallController()
		controller.actor.start()
		controller.actor.send({ type: 'INITIALIZE', isIos: false, installed: false })
		controller.actor.send({ type: 'AVAILABLE', prompt: {
			prompt,
			userChoice: new Promise((resolve) => { resolveChoice = resolve })
		} as unknown as BeforeInstallPromptEvent })
		const pending = controller.prompt()
		await controller.prompt()
		expect(prompt).toHaveBeenCalledOnce()
		expect(controller.actor.getSnapshot().value).toBe('prompting')
		resolveChoice({ outcome: 'dismissed' })
		await pending
		expect(controller.actor.getSnapshot().value).toBe('dismissed')
		expect(controller.actor.getSnapshot().context.prompt).toBeNull()
		controller.actor.stop()
	})

	it('waits for installation after acceptance', async () => {
		const controller = createInstallController()
		controller.actor.start()
		controller.actor.send({ type: 'INITIALIZE', isIos: false, installed: false })
		controller.actor.send({ type: 'AVAILABLE', prompt: {
			prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' })
		} as unknown as BeforeInstallPromptEvent })
		await controller.prompt()
		expect(controller.actor.getSnapshot().value).toBe('accepted_waiting')
		controller.actor.send({ type: 'INSTALLED' })
		expect(controller.actor.getSnapshot().value).toBe('installed')
		expect(controller.actor.getSnapshot().context.prompt).toBeNull()
	})

	it('handles rejected browser prompts and can accept a fresh prompt', async () => {
		const controller = createInstallController()
		controller.actor.start()
		controller.actor.send({ type: 'INITIALIZE', isIos: false, installed: false })
		const event = { prompt: async () => { throw new Error('expired') }, userChoice: Promise.resolve({ outcome: 'accepted' }) } as unknown as BeforeInstallPromptEvent
		controller.actor.send({ type: 'AVAILABLE', prompt: event })
		await controller.prompt()
		expect(controller.actor.getSnapshot().value).toBe('failed')
		controller.actor.send({ type: 'AVAILABLE', prompt: event })
		expect(controller.actor.getSnapshot().value).toBe('available')
		controller.actor.stop()
	})

	it('does not let a late dismissal overwrite appinstalled', async () => {
		let resolveChoice!: (choice: { outcome: 'dismissed' }) => void
		const controller = createInstallController()
		controller.actor.start()
		controller.actor.send({ type: 'INITIALIZE', isIos: false, installed: false })
		controller.actor.send({ type: 'AVAILABLE', prompt: {
			prompt: async () => {}, userChoice: new Promise((resolve) => { resolveChoice = resolve })
		} as unknown as BeforeInstallPromptEvent })
		const pending = controller.prompt()
		controller.actor.send({ type: 'INSTALLED' })
		resolveChoice({ outcome: 'dismissed' })
		await pending
		await Promise.resolve()
		expect(controller.actor.getSnapshot().value).toBe('installed')
	})
})
