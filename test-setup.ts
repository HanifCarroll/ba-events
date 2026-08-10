// Test preload (loaded before every test file via bunfig.toml `[test] preload`).
// Bun's native indexedDB is not usable in the test runner, and Dexie captures
// the `indexedDB` global once at module load (shared across test files in the
// same process). Force fake-indexeddb so any test that opens a Dexie database
// (e.g. the guest-conversations store) runs against a deterministic
// implementation regardless of module load order.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

Object.assign(globalThis, {
  indexedDB: new IDBFactory(),
  IDBKeyRange,
})
