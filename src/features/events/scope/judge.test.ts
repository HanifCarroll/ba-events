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
  it('skips the model only for exact Passline template copy with no facets', async () => {
    const sora = passlineListing('Sora')
    const name = 'Ciclo JamSweetHome | Bandas & JAMs'
    const encoded = { ...passlineListing(name.replace('&', '&amp;')), name }
    const captionOnly = { name: sora.name, source: sora.source, descriptionEs: '&nbsp;',
      caption: `\n${sora.descriptionEs.toUpperCase().replaceAll(' ', '  ')}\n` }
    const listings = [sora, encoded, captionOnly]
    const request = vi.fn(() => Promise.reject(new Error('Template-only listings should not reach the model')))
    expect(await judgeScopeBatch(listings, request)).toEqual(listings.map(() => ({
      scope: 'out', reason: 'unclear: The listing has only ticket-sale text, with no program or event type.',
    })))
    expect(request).not.toHaveBeenCalled()
  })

  it('sends every other listing to the model unchanged, even when the template is present', async () => {
    const sora = passlineListing('Sora')
    const trap = passlineListing('Hard Trap Fest 3')
    const lineup = '-Show de Dagger por primera vez en la Hard Trap Fest -Show Co-estelar Flakka Flakka Artistas Emergentes:'
    const cases = [
      [{ ...sora, caption: 'Consigue tus entradas para Sora. En vivo: Pez y Fin del Mundo. Más info en Passline.' }, inScope],
      [{ ...trap, descriptionEs: lineup }, inScope],
      [{ ...trap, descriptionEs: `${trap.descriptionEs}\n${lineup}` }, inScope],
      [{ name: 'Concierto de Jazz en vivo', source: 'passline', descriptionEs: '', descriptionEn: null, caption: '  ' }, inScope],
      [{ ...sora, facets: { activities: ['live-music'] } }, inScope],
      [{ ...sora, caption: 'Sora 🎸🎤' }, inScope],
      [{ ...sora, source: 'instagram' }, unclear],
      [{ ...sora, name: 'Sora Edición 2' }, unclear],
      [{ ...sora, descriptionEs: 'Consigue tus entradas para Sora en Passline.' }, unclear],
      [{ ...passlineListing('Venta de entradas'), descriptionEs: '' }, unclear],
    ] as const
    const inputs = cases.map(([input]) => input)
    const outcomes = cases.map(([, result]) => result)
    const request = vi.fn(async () => ({ judgments: outcomes.map((result, index) => ({ index, ...result })) }))
    expect(await judgeScopeBatch(inputs, request)).toEqual(outcomes)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(inputs)
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
