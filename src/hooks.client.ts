import { getLocale, overwriteGetLocale } from '#paraglide/runtime.js'
import { discoveryLocale } from '#features/discovery/lib/discovery-locale.ts'

const preferredLocale = getLocale
overwriteGetLocale(() => discoveryLocale(window.location.pathname) ?? preferredLocale())
