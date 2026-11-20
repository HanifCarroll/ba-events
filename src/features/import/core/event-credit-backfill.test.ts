import { expect, it, vi } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { backfillEventCredits } from './event-credit-backfill.ts'

it('previews without writing and records only successful, guarded scheduled updates', async () => {
  const { db, dispose } = await freshD1()
  try {
    const from = '2026-11-20T03:00:00.000Z'
    const seed = db.prepare('INSERT INTO events (id, name, starts_at, source, status, description_es, organizer_name) VALUES (?, ?, ?, \'luma\', ?, ?, ?)')
    await db.batch([
      seed.bind('a', 'Muestra sintética', from, 'scheduled', 'Actúa el Trío Nube.', 'Grupo existente'),
      seed.bind('b', 'Sin crédito', from, 'scheduled', 'Visita a la muestra.', null),
      seed.bind('c', 'Falló la extracción', from, 'scheduled', 'Reintentar.', null),
      seed.bind('d', 'Se canceló', from, 'scheduled', 'Organiza la Asociación Puente.', null),
      seed.bind('e', 'Cancelado', from, 'canceled', 'Nada.', null),
      seed.bind('f', 'Anterior', '2026-11-19T08:00:00.000Z', 'scheduled', 'Nada.', null),
      seed.bind('g', 'Sin descripción', from, 'scheduled', null, null),
    ])
    const participants = { organizer: { name: 'Asociación Puente' }, performers: [{ name: 'Trío Nube' }] }
    const extract = vi.fn(async ([text]: readonly (string | null)[]) => text === 'Actúa el Trío Nube.' ? participants : {})
    const preview = await backfillEventCredits(db, { from, limit: 2, apply: false, extract })
    expect(preview).toMatchObject([{ id: 'a', status: 'preview', performers: participants.performers }, { id: 'b', status: 'preview' }])
    expect(preview[0]?.organizer).toBeUndefined()
    expect(await db.prepare('SELECT performers, enrichment_provenance FROM events WHERE id = \'a\'').first())
      .toEqual({ performers: null, enrichment_provenance: null })

    const apply = await backfillEventCredits(db, { from, limit: 10, apply: true, extract: async descriptions => {
      if (descriptions[0] === 'Reintentar.') throw new Error('Fixture provider unavailable')
      if (descriptions[0] === 'Organiza la Asociación Puente.') {
        await db.prepare("UPDATE events SET status = 'canceled' WHERE id = 'd'").run()
        return participants
      }
      return extract(descriptions)
    } })
    expect(apply.map(({ id, status }) => [id, status])).toEqual([
      ['a', 'applied'], ['b', 'applied'], ['c', 'extraction-failed'], ['d', 'changed-since-read'],
    ])
    expect(await db.prepare('SELECT organizer_name, performers FROM events WHERE id = \'a\'').first())
      .toEqual({ organizer_name: 'Grupo existente', performers: JSON.stringify(participants.performers) })
    expect(await db.prepare('SELECT organizer_name, performers FROM events WHERE id = \'d\'').first())
      .toEqual({ organizer_name: null, performers: null })
    expect((await backfillEventCredits(db, { from, limit: 10, apply: false, extract })).map(r => r.id)).toEqual(['c'])
  } finally { await dispose() }
})
