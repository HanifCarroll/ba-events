import { describe, expect, it } from 'vitest'
import { ENRICHMENT_CASES, scoreEnrichmentCase } from '../../../../evals/enrichment/suite.ts'

describe('enrichment source-control graders', () => {
  it('covers all five source-enrichment areas with English and Spanish controls', () => {
    expect(new Set(ENRICHMENT_CASES.map(test => test.task))).toEqual(new Set(['translation','summary','facets','venue','missing']))
    expect(new Set(ENRICHMENT_CASES.map(test => test.id)).size).toBe(ENRICHMENT_CASES.length)
    for (const task of ['translation','summary','facets','venue','missing']) expect(new Set(ENRICHMENT_CASES.filter(test=>test.task===task).map(test=>test.locale))).toEqual(new Set(['en','es']))
  })
  it('rejects fabricated venues/descriptions and unsupported genre or romance facets', () => {
    expect(scoreEnrichmentCase(ENRICHMENT_CASES.find(test=>test.id==='venue-address-only')!, 'Calle Ficticia')).not.toEqual([])
    expect(scoreEnrichmentCase(ENRICHMENT_CASES.find(test=>test.id==='missing-description-en')!, 'An intimate concert.')).not.toEqual([])
    const test = ENRICHMENT_CASES.find(test=>test.id==='facets-no-romance-or-genre')!
    expect(scoreEnrichmentCase(test,{ eventType:['food'],activities:['dinner'],genres:['jazz'],vibes:['romantic'] })).toContain('unsupported facet genres')
    expect(scoreEnrichmentCase(test,{ eventType:['food'],activities:['dinner'] })).toEqual([])
  })
  it('retains translation source controls and catches leaked summary details', () => {
    const translated = 'Ada Ríos presents 35 original works. The visit lasts 45 minutes.\n\nDrinks are not included.'
    expect(scoreEnrichmentCase(ENRICHMENT_CASES[0],translated)).toEqual([])
    expect(scoreEnrichmentCase(ENRICHMENT_CASES[0],translated.replace('35','40'))).not.toEqual([])
    expect(scoreEnrichmentCase(ENRICHMENT_CASES[0],translated.replace('45','450'))).not.toEqual([])
    expect(scoreEnrichmentCase(ENRICHMENT_CASES[0],translated.replace('45','45,000'))).not.toEqual([])
    expect(scoreEnrichmentCase(ENRICHMENT_CASES.find(test=>test.id==='summary-en')!,'An intimate jazz concert at Sala Prueba at 19:30.')).not.toEqual([])
  })
})
