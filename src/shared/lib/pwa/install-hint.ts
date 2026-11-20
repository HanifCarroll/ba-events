const KEY = 'ba:home-install-hint'
type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>
type LocalStorage = { readonly localStorage: VisitStorage }

export function recordInstallHintVisit(browser: LocalStorage & { readonly sessionStorage: VisitStorage } = window): boolean {
	try {
		const visits = browser.localStorage.getItem(KEY)
		if (visits === 'hidden') return false
		const thisVisit = browser.sessionStorage.getItem(KEY)
		if (thisVisit === '1' || thisVisit === '2') return thisVisit === '2'
		const next = visits === '1' || visits === '2' ? '2' : '1'
		browser.localStorage.setItem(KEY, next)
		browser.sessionStorage.setItem(KEY, next)
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
