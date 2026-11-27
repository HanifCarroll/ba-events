import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const roots = ['src', 'scripts', 'evals']
const owner = 'src/shared/lib/db/vector-sync.ts'
const sourceFile = /\.(?:[cm]?[jt]sx?|svelte)$/u
const testFile = /(?:\.test|\.spec|\.d)\.[cm]?[jt]sx?$/u
// These write method names are reserved for Vectorize in production code. Include property references so
// extracting a bound method instead of calling it directly does not bypass the check.
const writeMethod = /(?:\.\s*(?:upsert|insert|deleteByIds)(?![\w$-])|\[\s*['"`](?:upsert|insert|deleteByIds)['"`]\s*\])/u
const queueTable = /\b(?:vector_sync|vector_metadata_sync)\b/iu

describe('event Vectorize ownership', () => {
  it('reserves Vectorize writes and both retry queues for the shared vector module', () => {
    const violations = roots.flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && sourceFile.test(entry.name) && !testFile.test(entry.name))
      .map(entry => `${entry.parentPath}/${entry.name}`)
      .filter(path => path !== owner && !path.startsWith('src/lib/paraglide/'))
      .flatMap(path => {
        const source = readFileSync(path, 'utf8')
        return [writeMethod.test(source) && `${path}: Vectorize write method`,
          queueTable.test(source) && `${path}: retry queue`].filter(Boolean)
      }))
    expect(violations).toEqual([])
  })
})
