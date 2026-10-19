import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

describe('eval-only complete directions tool', () => {
  for (const mode of ['complete', 'default', 'continue', 'details-first', 'failed', 'ambiguous']) {
    for (const locale of ['en', 'es']) {
      it(`preserves source reads and termination for ${mode}/${locale}`, async () => {
        const { stdout } = await promisify(execFile)('bun', [fileURLToPath(new URL('./direct-directions.fixture.ts', import.meta.url)), mode, locale], {
          timeout: 5000, env: { PATH: process.env.PATH, AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false' },
        })
        const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
        expect(result.fallback).toBe(false)
        expect(result.calls).toBe(mode === 'complete' ? 1 : ['continue', 'details-first'].includes(mode) ? 3 : 2)
        if (mode === 'ambiguous') { expect(result.kind).toBe('clarification'); expect(result.directionReads).toBe(0) }
        else if (['continue', 'details-first'].includes(mode)) { expect(result.detailReads).toBe(1); expect(result.text).toBe('The source describes live jazz.') }
        else {
          expect(result.eventId).toBe('11111111-1111-4111-8111-111111111111')
          expect(result.directionReads).toBe(mode === 'failed' ? 2 : 1)
          if (mode !== 'default') expect(result.text).toBe(locale === 'es' ? 'Abrí el mapa para ver cómo llegar.' : 'Open the map for directions.')
        }
      })
    }
  }
})
