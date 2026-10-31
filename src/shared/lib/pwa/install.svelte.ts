import { isIosDevice, isStandalone, type BeforeInstallPromptEvent } from './install'
import { createInstallController } from './install.machine.ts'

const controller = createInstallController()
let snapshot = $state.raw(controller.actor.getSnapshot())

/** Public compatibility view: the machine is the sole owner of prompt availability. */
export const installState = {
	get deferredPrompt() { return snapshot.matches('available') ? snapshot.context.prompt : null },
	get isIos() { return snapshot.context.isIos },
	get installed() { return snapshot.matches('installed') },
	get initialized() { return !snapshot.matches('uninitialized') },
	get phase() { return snapshot.value }
}

export function initInstallPrompt(): void {
	if (typeof window === 'undefined' || installState.initialized) return
	controller.actor.subscribe((next) => { snapshot = next })
	controller.actor.start()
	controller.actor.send({
		type: 'INITIALIZE',
		isIos: isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
		installed: isStandalone(
			window.matchMedia('(display-mode: standalone)').matches,
			Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
		)
	})
	window.addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault()
		controller.actor.send({ type: 'AVAILABLE', prompt: event as BeforeInstallPromptEvent })
	})
	window.addEventListener('appinstalled', () => controller.actor.send({ type: 'INSTALLED' }))
}

export async function promptInstall(): Promise<void> {
	await controller.prompt()
}
