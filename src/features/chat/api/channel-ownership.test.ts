import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'

const roots = ['src/features/telegram', 'src/telegram-worker']
const chatTables = 'conversations|messages|chat_turns|guest_chat_debug|guest_request_lifecycle'
const chatSql = new RegExp(
  String.raw`\b(?:FROM|JOIN|INTO|UPDATE(?:\s+OR\s+\w+)?|TABLE|REFERENCES)\s+(?:[\w]+\s*\.\s*)?["'\x60\[]?(?:${chatTables})\b`,
  'iu',
)

it('reserves chat table SQL for chat, not the Telegram adapter', () => {
  const violations = roots.flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:[cm]?[jt]sx?|svelte|sql)$/u.test(entry.name))
    .map(entry => `${entry.parentPath}/${entry.name}`)
    .filter(path => chatSql.test(readFileSync(path, 'utf8'))))
  expect(violations).toEqual([])
})
