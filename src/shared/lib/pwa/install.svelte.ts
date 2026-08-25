import { isIosDevice, isStandalone, type BeforeInstallPromptEvent } from './install'

export const installState = $state({
	deferredPrompt: null as BeforeInstallPromptEvent | null,
	isIos: false,
	installed: false,
	initialized: false
})

export function initInstallPrompt(): void {
	if (typeof window === 'undefined' || installState.initialized) return
	installState.initialized = true

	installState.isIos = isIosDevice(
		navigator.userAgent,
		navigator.platform,
		navigator.maxTouchPoints
	)
	installState.installed = isStandalone(
		window.matchMedia('(display-mode: standalone)').matches,
		Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
	)

	window.addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault()
		installState.deferredPrompt = event as BeforeInstallPromptEvent
	})
	window.addEventListener('appinstalled', () => {
		installState.installed = true
		installState.deferredPrompt = null
	})
}

export async function promptInstall(): Promise<void> {
	const event = installState.deferredPrompt
	if (!event) return

	try {
		await event.prompt()
		await event.userChoice
	} finally {
		installState.deferredPrompt = null
	}
}
