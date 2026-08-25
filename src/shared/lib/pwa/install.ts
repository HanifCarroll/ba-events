export type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function isIosDevice(
	userAgent: string,
	platform = '',
	touchPoints = 0
): boolean {
	return /iphone|ipad|ipod/i.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1)
}

export function isStandalone(
	standaloneMediaMatches: boolean,
	navigatorStandalone = false
): boolean {
	return standaloneMediaMatches || navigatorStandalone
}
