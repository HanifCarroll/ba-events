import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

const src = fileURLToPath(new URL('../src/', import.meta.url))
const worker = 'chat-delivery-worker'
const web = ['features/chat/api', 'routes/api/chat']
const protocol = 'features/chat/lib/delivery-protocol.ts'
const aliases = { '#features/': 'features/', '#shared/': 'shared/', '#lib/': 'lib/', '$lib/': 'lib/' }

function importTarget(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) return resolve(src, dirname(file), specifier)
  for (const [alias, target] of Object.entries(aliases)) {
    if (specifier.startsWith(alias)) return resolve(src, target + specifier.slice(alias.length))
  }
}

function assertNoImports(files: string[], forbidden: string[]) {
  expect(files.length).toBeGreaterThan(0)
  const violations = files.flatMap(file => {
    const source = readFileSync(resolve(src, file), 'utf8')
    return ts.preProcessFile(source, true, true).importedFiles.flatMap(({ fileName }) => {
      const target = importTarget(file, fileName)
      return forbidden.some(folder => target === resolve(src, folder) || target?.startsWith(resolve(src, folder) + '/'))
        ? [`${file} imports ${fileName}`] : []
    })
  })
  expect(violations).toEqual([])
}

const sources = (folders: string[]) => globSync(folders.map(folder => `${folder}/**/*.{ts,js,mts,mjs}`), { cwd: src })

it('keeps the delivery worker independent of web chat server modules', () => {
  assertNoImports(sources([worker]), web)
})

it('keeps web chat server modules independent of the delivery worker', () => {
  assertNoImports(sources(web), [worker])
})

it('keeps the shared protocol independent of both runtime owners', () => {
  assertNoImports([protocol], [worker, ...web])
})
