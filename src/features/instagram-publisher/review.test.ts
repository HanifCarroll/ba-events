import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { freshD1 } from '../../../tests/support/d1.ts'
import { OK, readReviewKey, reviewWithOpenAI, type ReviewInput } from './review.ts'
import { loadReviewSources } from './review-evidence.ts'

const id = '00000000-0000-4000-8000-000000000001'
const from = '2026-11-25'
const startsAt = '2026-11-26T00:00:00.000Z'
const sourceUrl = 'https://www.instagram.com/p/synthetic-18-mundos/'
const caption = '18 mundos, montaje anual de Entrenamiento Perro 2026. Teatro físico, funciones gratuitas en Café Artigas.'
const flyerText = '18 MUNDOS · TEATRO FÍSICO · FUNCIONES GRATUITAS'
const photo = (text: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="660" height="220">
  <rect width="660" height="220" fill="#fff"/><text x="20" y="120" fill="#111" font-size="21">${text}</text></svg>`)
const input: ReviewInput = { format: 'hoy', from, to: from, caption: null, threads: '21:00 · 18 mundos · Café Artigas, Almagro · Gratis', frames: [],
  events: [{ id, title: '18 mundos — Montaje anual', date: from, time: '21:00', startsAt, venue: 'Café Artigas', barrio: 'Almagro',
    description: 'Entrenamiento canino unipersonal para fortalecer la obediencia con tu perro.', price: 'Gratis', handle: null, via: false, imageUrl: null }] }
const config = { model: 'gpt-6.2-sol', keyFile: '/unused' }
const prompt = readFileSync(new URL('./review-prompt.md', import.meta.url), 'utf8')
const wrong = { id, verdict: 'wrong', field: 'summary', reason: 'The flyer advertises a physical-theatre performance, not dog training.', question: null }
const response = (events: unknown[]) => Response.json({ status: 'completed', model: 'gpt-6.2-sol-test', output: [
  { type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ post: OK, events }) }] },
] })

it('reads linked D1 evidence and sends the 18 mundos contradiction with the actual rendered frames to Responses', async () => {
  const { db, dispose } = await freshD1()
  const dir = mkdtempSync(join(tmpdir(), 'ig-review-fixture-'))
  const key = `${'a'.repeat(64)}.jpg`
  const flyer = await sharp(photo(flyerText)).jpeg().toBuffer()
  try {
    await db.batch([
      db.prepare("INSERT INTO events (id, name, starts_at, source) VALUES (?, '18 mundos', ?, 'instagram')").bind(id, startsAt),
      db.prepare("INSERT INTO instagram_sources (username, authority, qualification) VALUES ('synthetic_venue', 'venue', 'Synthetic'), ('synthetic_curator', 'curator', 'Synthetic')"),
      db.prepare("INSERT INTO intake_runs (id, local_date, state, reserved_usd, input) VALUES ('test', ?, 'succeeded', 0.01, '{}')").bind(from),
      db.prepare(`INSERT INTO intake_observations (id, run_id, post_id, source_username, post_url, caption, published_at, content_hash)
        VALUES ('venue-post', 'test', 'post1', 'synthetic_venue', ?, ?, '2026-11-22T12:00:00.000Z', ?),
        ('curator-post', 'test', 'post2', 'synthetic_curator', 'https://www.instagram.com/p/synthetic-repost/', 'Synthetic repost', '2026-11-23T12:00:00.000Z', ?)`)
        .bind(sourceUrl, caption, 'a'.repeat(64), 'b'.repeat(64)),
      db.prepare("INSERT INTO intake_candidates (id, revision, payload) VALUES ('candidate', 2, '{}')"),
      db.prepare(`INSERT INTO intake_candidate_revisions (candidate_id, revision, payload) VALUES ('candidate', 1, ?)`)
        .bind(JSON.stringify({ evidence: [{ media_id: 'flyer' }, { kind: 'official_page', excerpt: 'Miércoles 25, función 21:00', fields: ['time'] }] })),
      db.prepare("INSERT INTO event_source_evidence (event_id, candidate_id, observation_id, revision) VALUES (?, 'candidate', 'venue-post', 1), (?, 'candidate', 'curator-post', 2)").bind(id, id),
      db.prepare(`INSERT INTO intake_media (id, observation_id, position, object_key, content_type, sha256)
        VALUES ('flyer', 'venue-post', 1, ?, 'image/jpeg', ?), ('unrelated', 'venue-post', 0, ?, 'image/jpeg', ?)`)
        .bind(key, 'a'.repeat(64), `${'b'.repeat(64)}.jpg`, 'b'.repeat(64)),
    ])
    const retained = vi.fn(async () => flyer)
    const sources = await loadReviewSources([id], async sql => (await db.prepare(sql).all()).results, retained)
    expect(retained.mock.calls).toEqual([[key]])
    expect(sources.get(id)).toMatchObject({ caption, postUrl: sourceUrl, officialExcerpts: expect.stringContaining('función 21:00'), flyer: expect.stringMatching(/^data:image\/jpeg;base64,/) })
    const frames = await Promise.all(['Hoy en Buenos Aires', 'Entrenamiento canino', 'Más planes'].map(async (text, index) => {
      const file = join(dir, `frame-${index}.jpg`)
      await sharp(photo(text)).jpeg().toFile(file)
      return file
    }))
    const api: typeof fetch = async (url, options) => {
      expect(url).toBe('https://api.openai.com/v1/responses')
      expect(options?.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' })
      const body = JSON.parse(String(options?.body))
      expect(body).toMatchObject({ instructions: expect.stringContaining('untrusted evidence'), store: false,
        text: { format: { type: 'json_schema', strict: true } } })
      const parts = body.input[0].content
      expect(JSON.stringify(parts)).toContain('Entrenamiento canino')
      expect(JSON.stringify(parts)).toContain(caption)
      expect(JSON.stringify(parts)).toContain(input.threads)
      expect(JSON.stringify(parts)).not.toContain('Synthetic repost')
      expect(parts.filter((part: { type: string }) => part.type === 'input_image')).toEqual([
        expect.objectContaining({ image_url: `data:image/jpeg;base64,${readFileSync(frames[0]!).toString('base64')}` }),
        expect.objectContaining({ image_url: `data:image/jpeg;base64,${readFileSync(frames[1]!).toString('base64')}` }),
        expect.objectContaining({ image_url: sources.get(id)?.flyer }),
        expect.objectContaining({ image_url: `data:image/jpeg;base64,${readFileSync(frames[2]!).toString('base64')}` }),
      ])
      return response([wrong])
    }
    const result = await reviewWithOpenAI(config, 'synthetic-token', prompt, { ...input, frames }, frames, sources, api)
    expect(result).toEqual({ model: 'gpt-6.2-sol-test', post: OK, events: [wrong] })
  } finally { rmSync(dir, { recursive: true, force: true }); await dispose() }
})

it('refuses missing, duplicate, invalid, or invented event verdicts', async () => {
  const file = new URL('./review-prompt.md', import.meta.url).pathname // Fake bytes; the injected API never decodes them.
  for (const events of [[], [wrong, wrong], [{ ...wrong, id: 'invented' }], [{ ...wrong, reason: null }]]) {
    await expect(reviewWithOpenAI(config, 'key', prompt, input, [file, file, file], new Map(), async () => response(events)))
      .rejects.toThrow('invalid or incomplete verdicts')
  }
})

it('reads the OpenAI key only from a mode-600 file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ig-review-key-'))
  const path = join(dir, 'key')
  try {
    expect(() => readReviewKey(path)).toThrow('mode 600')
    writeFileSync(path, 'synthetic-token\n')
    chmodSync(path, 0o644)
    expect(() => readReviewKey(path)).toThrow('mode 600')
    chmodSync(path, 0o600)
    expect(readReviewKey(path)).toBe('synthetic-token')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
