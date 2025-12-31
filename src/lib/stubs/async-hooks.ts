/**
 * Browser stub for node:async_hooks
 * This module is server-only but leaks into client bundle analysis.
 * Provides a no-op implementation to satisfy the bundler.
 */

export class AsyncLocalStorage<T> {
  getStore(): T | undefined {
    return undefined
  }

  run<R>(_store: T, callback: () => R): R {
    return callback()
  }

  enterWith(_store: T): void {
    // no-op in browser
  }

  disable(): void {
    // no-op in browser
  }
}

export function executionAsyncId(): number {
  return 0
}

export function triggerAsyncId(): number {
  return 0
}

export function executionAsyncResource(): object {
  return {}
}

export class AsyncResource {
  constructor(_type: string, _options?: object) {}

  runInAsyncScope<R>(fn: () => R): R {
    return fn()
  }

  emitDestroy(): this {
    return this
  }

  asyncId(): number {
    return 0
  }

  triggerAsyncId(): number {
    return 0
  }
}
