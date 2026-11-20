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
  it('passes only event evidence to the model for any Passline title', async () => {
    const sora = passlineListing('Sora')
    const edition = { ...passlineListing('Sora Edición 2'), caption: '  SORA EDICION 2!  ' }
    const punctuation = passlineListing('Jazz + Trío (en vivo) • Sala Chica')
    const captionOnly = { name: punctuation.name, source: punctuation.source, caption: punctuation.descriptionEs }
    const concert = passlineListing('Concierto de Jazz en vivo')
    const lineup = '-Show de Dagger por primera vez en la Hard Trap Fest -Show Co-estelar Flakka Flakka Artistas Emergentes:'
    const fest = passlineListing('Hard Trap Fest 3')
    const mixed = { ...fest, descriptionEs: `${fest.descriptionEs}\n${lineup}`,
      caption: `Primera fecha 🎸\n${fest.descriptionEs}\nSala chica.` }
    const bareConcert = { ...concert, descriptionEs: '' }
    const outcomes = [unclear, unclear, inScope, inScope, inScope, inScope, inScope]
    const request = vi.fn(async () => ({ judgments: outcomes.map((result, index) => ({ index, ...result })) }))
    expect(await judgeScopeBatch([sora, edition, concert, { ...fest, descriptionEs: lineup }, mixed, bareConcert, captionOnly], request))
      .toEqual(outcomes)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith([
      { ...sora, descriptionEs: '' }, { ...edition, descriptionEs: '', caption: '' }, bareConcert,
      { ...fest, descriptionEs: lineup }, { ...mixed, descriptionEs: lineup, caption: 'Primera fecha 🎸\nSala chica.' },
      bareConcert, { ...captionOnly, caption: '' },
    ])
  })

  it('strips the Passline opening even when the embedded title uses HTML entities', async () => {
    const name = 'Ciclo JamSweetHome | Bandas & JAMs'
    const opening = 'Consigue tus entradas para Ciclo JamSweetHome | Bandas &amp; JAMs en Passline.'
    const listing = { ...passlineListing(name.replace('&', '&amp;')), name }
    const lineup = 'En vivo: Trío Nube &amp; Cuarteto Sur.'
    const mixed = { ...listing, descriptionEs: `${listing.descriptionEs}\n${lineup}`, caption: `Abre el trío.\n${opening}\nCierra el cuarteto.` }
    const request = vi.fn(async () => ({ judgments: [{ index: 0, ...inScope }, { index: 1, ...inScope }] }))
    await judgeScopeBatch([listing, mixed], request)
    expect(request).toHaveBeenCalledWith([
      { ...listing, descriptionEs: '' },
      { ...mixed, descriptionEs: lineup, caption: 'Abre el trío.\nCierra el cuarteto.' },
    ])
  })

  it('bypasses the model only for Passline sales titles with no remaining evidence or facets', async () => {
    const sales = passlineListing('Venta de entradas')
    const caption = { ...sales, caption: 'Venta de entradas 🎸🎤' }
    const facets = { ...sales, facets: { activities: ['live-music'] } }
    const otherSource = [
      { ...sales, source: 'instagram' },
      { name: 'Pez', caption: 'Pez 🎸🎤', source: 'instagram' },
      { name: 'Poesía', descriptionEs: '' },
    ]
    const party = passlineListing('Club Night')
    const partyOut = { scope: 'out', reason: 'It is a club party.' }
    const outcomes = [inScope, inScope, unclear, inScope, inScope, partyOut]
    const request = vi.fn(async () => ({ judgments: outcomes.map((result, index) => ({ index, ...result })) }))
    const ticketOnly = { scope: 'out', reason: 'unclear: The listing has only ticket-sale text, with no program or event type.' }
    expect(await judgeScopeBatch([sales, caption, facets, ...otherSource, party, { ...sales, descriptionEs: '' }], request))
      .toEqual([ticketOnly, ...outcomes, ticketOnly])
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith([
      { ...caption, descriptionEs: '' }, { ...facets, descriptionEs: '' }, ...otherSource, { ...party, descriptionEs: '' },
    ])
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
