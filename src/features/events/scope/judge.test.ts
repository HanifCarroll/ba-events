import { describe, expect, it, vi } from 'vitest'
import { runJsonFixture } from '../../../../tests/support/run-fixture.ts'
import { decodeScopeJudgments, judgeScopeBatch, SCOPE_MODEL } from './judge.ts'

const inScope = { scope: 'in', reason: 'It is a small-room live show.' }
const unclear = { scope: 'out', reason: 'unclear: The listing does not say what takes place.' }

const passlineListing = (name: string) => ({
  name, source: 'passline',
  descriptionEs: `Consigue tus entradas para ${name} en Passline. Encuentra detalles, asegura tu asistencia y prepárate para disfrutar de una experiencia inolvidable.`,
})

describe('scope judgment', () => {
  it('asks the model to judge template-only Passline listings based on their remaining evidence', async () => {
    const sora = passlineListing('Sora')
    const concert = passlineListing('Concierto en vivo: Pez y Fin del Mundo')
    const withFacets = { ...concert, venue: 'Sala Sintética', categories: ['music'], facets: { activities: ['live-music'] } }
    const name = 'Jam sintética & ensamble'
    const encoded = { ...passlineListing(name.replace('&', '&amp;')), name }
    const listings = [
      { ...sora, descriptionEn: sora.descriptionEs, caption: `\n${sora.descriptionEs.toUpperCase().replaceAll(' ', '  ')}\n` },
      concert, withFacets, encoded,
    ]
    const outcomes = [unclear, inScope, inScope, inScope]
    const request = vi.fn(async () => ({ judgments: outcomes.map((result, index) => ({ index, ...result })) }))
    expect(await judgeScopeBatch(listings, request)).toEqual(outcomes)
    expect(request).toHaveBeenCalledExactlyOnceWith([
      { ...sora, descriptionEs: null, descriptionEn: null, caption: null },
      { ...concert, descriptionEs: null },
      { ...withFacets, descriptionEs: null },
      { ...encoded, descriptionEs: null },
    ])
    expect(listings[0].descriptionEs).toBe(sora.descriptionEs)
  })

  it('preserves nonmatching text even alongside a matching Passline field', async () => {
    const sora = passlineListing('Sora')
    const concert = passlineListing('Festival Sintético')
    const lineup = `${concert.descriptionEs}\nEn vivo: Los Ensayos y Dúo Inventado.`
    const withLineup = { ...concert, descriptionEs: lineup, caption: concert.descriptionEs }
    const unchanged = [
      { name: 'Concierto de Jazz en vivo', source: 'passline', descriptionEs: '', descriptionEn: null, caption: '  ' },
      { ...sora, source: 'instagram' },
      { ...sora, name: 'Sora Edición 2' },
      { ...sora, descriptionEs: 'Consigue tus entradas para Sora en Passline.' },
    ]
    const outcomes = [inScope, inScope, unclear, unclear, unclear]
    const request = vi.fn(async () => ({ judgments: outcomes.map((result, index) => ({ index, ...result })) }))
    expect(await judgeScopeBatch([withLineup, ...unchanged], request)).toEqual(outcomes)
    expect(request).toHaveBeenCalledExactlyOnceWith([{ ...withLineup, caption: null }, ...unchanged])
  })

  it('rejects partial, extra, duplicate, mislabeled, or unreasoned output', () => {
    const valid = { index: 0, ...inScope }
    for (const value of [null, { judgments: [] }, { judgments: [valid], extra: 1 },
      { judgments: [{ ...valid, index: 1 }] }, { judgments: [{ ...valid, scope: 'maybe' }] },
      { judgments: [{ ...valid, reason: '' }] }, { judgments: [{ ...valid, reason: 'It is an open-访问 installation.' }] },
      { judgments: [{ ...valid, reason: unclear.reason }] },
      { judgments: [{ ...valid, internal: true }] }]) {
      expect(() => decodeScopeJudgments(value, 1)).toThrow()
    }
    expect(() => decodeScopeJudgments({ judgments: [valid, valid] }, 2)).toThrow()
  })

  it('requests native strict JSON with no reasoning, tools, or storage', () => {
    // Bun's module mocks can leak between suites; verify the real SDK in a fresh process.
    const { body, calls, judgments } = runJsonFixture(new URL('./judge-wire.fixture.ts', import.meta.url), [], {}, 4000)
    expect(body).toMatchObject({ model: SCOPE_MODEL, response_format: { type: 'json_schema', json_schema: { strict: true } },
      reasoning_effort: 'none', store: false })
    expect(body).not.toHaveProperty('tools')
    expect(judgments).toEqual([inScope])
    expect(calls).toBe(1)
  })
})
