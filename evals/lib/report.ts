#!/usr/bin/env bun
/** Shared eval reporting: per-case pass/fail, summary, non-zero exit on failure. */

export interface CaseResult {
  id: string
  pass: boolean
  failures: string[]
  /** extra context printed next to the case id */
  note?: string
}

export function printReport(suite: string, results: CaseResult[], summaryLines: string[] = []): void {
  console.log(`\n=== ${suite} ===`)
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}${r.note ? `  (${r.note})` : ''}`)
    for (const f of r.failures) console.log(`       - ${f}`)
  }
  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length} passed`)
  for (const line of summaryLines) console.log(line)
  if (passed !== results.length) process.exitCode = 1
}
