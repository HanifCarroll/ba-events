const KEY = 'ba:home-install-hint'
type LocalStorage = { readonly localStorage: Pick<Storage, 'getItem' | 'setItem'> }
type SessionStorage = { readonly sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }

export function preserveInstallHintVisit(browser: SessionStorage = window): void {
	try {
		// Paraglide reloads the document to apply the locale.
		browser.sessionStorage.setItem(KEY, 'locale-reload')
	} catch {
		// Blocked storage also prevents the hint from appearing.
	}
}

export function recordInstallHintVisit(browser: LocalStorage & SessionStorage = window, countVisit = true): boolean {
	try {
		const sameVisit = browser.sessionStorage.getItem(KEY) === 'locale-reload'
		if (sameVisit) browser.sessionStorage.removeItem(KEY)
		if (!countVisit) return false
		const storage = browser.localStorage
		const visits = storage.getItem(KEY)
		if (visits === 'hidden') return false
		const next = visits === '2' || (visits === '1' && !sameVisit) ? '2' : '1'
		storage.setItem(KEY, next)
		return next === '2'
	} catch {
		return false
	}
}

export function hideInstallHint(browser: LocalStorage = window): void {
	try {
		browser.localStorage.setItem(KEY, 'hidden')
	} catch {
		// The current page can hide the hint even if storage stops working.
	}
}
