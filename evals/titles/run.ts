#!/usr/bin/env bun
/**
 * Titles eval.
 *
 * Runs generateConversationTitle (the same core the server function uses)
 * on realistic first messages. Scorers, all deterministic:
 *   - non-empty, not the generic fallback
 *   - 2-8 words, <=60 chars, no surrounding quotes or trailing punctuation
 *   - language matches the message locale
 *
 * Usage: bun evals/titles/run.ts
 */
import { generateConversationTitle } from '#features/chat/api/generate-title.server.ts'
import { detectLanguage, mapWithConcurrency } from '../lib/checks.ts'
import { printReport, type CaseResult } from '../lib/report.ts'
import { TITLE_CASES } from './cases.ts'

console.log(`Running ${TITLE_CASES.length} title cases...`)
const results = await mapWithConcurrency(TITLE_CASES, 6, async (c): Promise<CaseResult> => {
  try {
    const title = await generateConversationTitle(c.firstMessage)
    const failures: string[] = []

    if (!title.trim()) failures.push('empty title')
    if (title.trim().toLowerCase() === 'new conversation') failures.push('generic fallback title')
    const words = title.trim().split(/\s+/).length
    if (words < 2 || words > 8) failures.push(`word count ${words} outside 2-8`)
    if (title.length > 60) failures.push(`length ${title.length} > 60 chars`)
    if (/^["']|["']$/.test(title.trim())) failures.push('surrounding quotes left in title')
    if (/[.!?]$/.test(title.trim())) failures.push('trailing punctuation')
    if (title.trim() && detectLanguage(title) !== c.locale) {
      failures.push(`language: expected ${c.locale}, detected ${detectLanguage(title)}`)
    }

    return { id: c.id, pass: failures.length === 0, failures, note: `"${title}"` }
  } catch (error) {
    return { id: c.id, pass: false, failures: [`runner error: ${String(error)}`] }
  }
})

printReport('titles', results)
