/**
 * Bun-only test-runtime preload.
 *
 * Loaded by literal `bun test` via bunfig.toml [test].preload — never by
 * `bun run test` (Vitest). Bun's `vi` is a subset of Vitest's, and Bun does
 * not run the Svelte compiler over precompiled `*.svelte.js` runes. This file
 * fills those gaps with behaviorally-equivalent shims so the same tests run
 * unchanged under both runners. Every shim is guarded so it never shadows a
 * real implementation if one appears.
 */

// IndexedDB must exist before any Dexie module is imported (Dexie captures the
// global at open time). Preload runs before every test file, so this is the
// only reliable ordering.
import 'fake-indexeddb/auto'
import { mock, vi } from 'bun:test'

// SvelteKit 3's `$app/env` is virtual in Vite but literal Bun has no plugin
// resolver. Tests exercise SSR behavior, so the server-side values are enough.
mock.module('$app/env', () => ({
	browser: false,
	building: false,
	dev: false,
	version: 'test'
}))

type AnyVi = typeof vi & Record<string, unknown>

// --- vi.mocked — identity. Under vi.mock the imported binding IS already the
// mock function; Vitest's vi.mocked is only a type-narrowing cast, so returning
// the value unchanged is behaviorally identical.
if (typeof vi.mocked !== 'function') {
	;(vi as AnyVi).mocked = (value: unknown) => value
}

// --- vi.hoisted — Bun does not hoist mock factories, but the only current use
// is a plain object literal captured by a vi.mock factory closure. Running the
// factory inline preserves those semantics.
if (typeof vi.hoisted !== 'function') {
	;(vi as AnyVi).hoisted = <T>(factory: () => T): T => factory()
}

// --- vi.stubEnv / vi.unstubAllEnvs — store and restore original process.env
// values (deleting the key when stubbed undefined, matching Vitest).
const envStack: Array<Record<string, string | undefined>> = []
if (typeof vi.stubEnv !== 'function') {
	;(vi as AnyVi).stubEnv = (name: string, value: string | undefined) => {
		envStack.push({ [name]: process.env[name] })
		if (value === undefined) delete process.env[name]
		else process.env[name] = value
	}
}
if (typeof vi.unstubAllEnvs !== 'function') {
	;(vi as AnyVi).unstubAllEnvs = () => {
		while (envStack.length) {
			const snapshot = envStack.pop()!
			for (const [name, value] of Object.entries(snapshot)) {
				if (value === undefined) delete process.env[name]
				else process.env[name] = value
			}
		}
	}
}

// --- vi.stubGlobal / vi.unstubAllGlobals — store and restore the property
// descriptor so globals like `fetch` are put back exactly as they were.
const globalStack: Array<Array<[string, PropertyDescriptor | undefined]>> = []
if (typeof vi.stubGlobal !== 'function') {
	;(vi as AnyVi).stubGlobal = (name: string, value: unknown) => {
		globalStack.push([[name, Object.getOwnPropertyDescriptor(globalThis, name)]])
		Object.defineProperty(globalThis, name, {
			value,
			configurable: true,
			writable: true,
			enumerable: true,
		})
	}
}
if (typeof vi.unstubAllGlobals !== 'function') {
	;(vi as AnyVi).unstubAllGlobals = () => {
		while (globalStack.length) {
			const snapshots = globalStack.pop()!
			for (const [name, descriptor] of snapshots) {
				if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name]
				else Object.defineProperty(globalThis, name, descriptor)
			}
		}
	}
}

// --- vi.advanceTimersByTimeAsync — sync advance plus a microtask flush (a
// handful of turns covers the fail-open promise chains in guest-debug tests).
if (typeof vi.advanceTimersByTimeAsync !== 'function') {
	;(vi as AnyVi).advanceTimersByTimeAsync = async (ms: number) => {
		vi.advanceTimersByTime(ms)
		for (let i = 0; i < 10; i++) await Promise.resolve()
	}
}

// --- Svelte rune globals. `@ai-sdk/svelte` ships precompiled `*.svelte.js`
// where `$state`/`$derived` are left as bare globals (vite-plugin-svelte
// compiles them in Vitest; Bun does not). The chat-stream test only exercises
// the message-correlation logic of the real `ai` package `AbstractChat`, so an
// identity shim (no reactivity) is behaviorally sufficient and never fakes the
// assertions under test.
if (!('$state' in globalThis)) {
	const $state = (value: unknown): unknown => value
	;(($state as unknown) as Record<string, unknown>).snapshot = (value: unknown) => value
	;(globalThis as Record<string, unknown>).$state = $state
}
if (!('$derived' in globalThis)) {
	;(globalThis as Record<string, unknown>).$derived = (value: unknown) => value
}
