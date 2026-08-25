import { describe, expect, it } from 'vitest'
import { missingSummaryUpdate, type SummaryBackfillRow } from './backfill-description-presentation.ts'

const row = (overrides: Partial<SummaryBackfillRow> = {}): SummaryBackfillRow => ({
  id: 'event-1',
  name: 'Event',
  starts_at: '2099-01-01T00:00:00Z',
  description_summary_es: null,
  description_summary_en: null,
  ...overrides,
})

describe('summary backfill selection', () => {
  it('selects only the missing locale and preserves the opposite summary', () => {
    expect(missingSummaryUpdate(row({ description_summary_en: 'A music workshop.' }))).toEqual({
      field: 'description_summary_es',
      source: 'A music workshop.',
      direction: 'en-to-es',
    })
  })

  it('does not overwrite bilingual or summary-less rows', () => {
    expect(missingSummaryUpdate(row())).toBeNull()
    expect(missingSummaryUpdate(row({ description_summary_es: 'Taller.', description_summary_en: 'Workshop.' }))).toBeNull()
  })
})
