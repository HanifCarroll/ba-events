#!/usr/bin/env bun
/**
 * Labeled bilingual golden set for the vibe-search scorer.
 *
 * Queries are labeled against the synthetic fixture corpus in
 * vibe-fixtures.ts (deterministic — the scorer is pure, so unlike the
 * DB-labeled semantic golden set this never goes stale). Each case declares:
 *
 * - relevant: fixture ids that MUST be returned for this query
 * - irrelevant: fixture ids that MUST NOT be returned (clear false positives)
 * - top: fixture id that must rank FIRST (strongest match)
 *
 * Coverage: chill (en), tranqui (es), techno, free (en), gratis (es),
 * date-like (en), cita (es), and neighborhood searches (en/es).
 */

export interface VibeGoldenQuery {
  query: string
  relevant: string[]
  irrelevant: string[]
  /** Fixture id that must rank first (strongest match), when unambiguous. */
  top?: string
  note?: string
}

export const VIBE_GOLDEN_QUERIES: VibeGoldenQuery[] = [
  {
    query: 'chill vibes',
    relevant: ['yoga-palermo', 'brunch-domingo'],
    irrelevant: ['techno-fabrik', 'maraton', 'reggaeton-bar'],
    top: 'yoga-palermo',
    note: 'Chill signal; loud/competitive events excluded by the strong-evidence gate.',
  },
  {
    query: 'planes tranqui',
    relevant: ['yoga-palermo', 'brunch-domingo'],
    irrelevant: ['techno-fabrik', 'maraton', 'reggaeton-bar'],
    top: 'yoga-palermo',
    note: 'Spanish tranqui signal.',
  },
  {
    query: 'chill tonight',
    relevant: ['yoga-palermo', 'brunch-domingo'],
    irrelevant: ['techno-fabrik', 'reggaeton-bar', 'maraton'],
    top: 'yoga-palermo',
    note: 'Regression: the "tonight" time word must not change chill ranking. The today/tonight context penalty is uniform across the pinned December fixtures (none starts today), so it affects absolute scores, not order.',
  },
  {
    query: 'algo tranqui esta noche',
    relevant: ['yoga-palermo', 'brunch-domingo'],
    irrelevant: ['techno-fabrik', 'reggaeton-bar', 'maraton'],
    top: 'yoga-palermo',
    note: 'Spanish mirror of "chill tonight" (esta noche → today signal).',
  },
  {
    query: 'underground techno',
    relevant: ['techno-fabrik'],
    irrelevant: ['cena-romantica', 'maraton', 'charla-tecnologia', 'tango-milonga'],
    top: 'techno-fabrik',
    note: 'Techno signal beats the energetic overlap of other music nights.',
  },
  {
    query: 'free events',
    relevant: ['feria-gratis', 'tango-milonga', 'feria-libros'],
    irrelevant: ['brunch-domingo', 'cena-romantica', 'maraton'],
    note: 'is_free flag drives the ranking; paid events penalized.',
  },
  {
    query: 'eventos gratis',
    relevant: ['feria-gratis', 'tango-milonga', 'feria-libros'],
    irrelevant: ['brunch-domingo', 'cena-romantica', 'maraton'],
    note: 'Spanish gratis signal.',
  },
  {
    query: 'romantic date',
    relevant: ['cena-romantica'],
    irrelevant: ['techno-fabrik', 'maraton', 'charla-tecnologia', 'feria-gratis'],
    top: 'cena-romantica',
    note: 'Date-like signal.',
  },
  {
    query: 'plan para una cita',
    relevant: ['cena-romantica'],
    irrelevant: ['techno-fabrik', 'maraton', 'charla-tecnologia', 'feria-gratis'],
    top: 'cena-romantica',
    note: 'Spanish date-like signal.',
  },
  {
    query: 'things to do in palermo',
    relevant: ['yoga-palermo', 'techno-fabrik', 'reggaeton-bar', 'maraton'],
    irrelevant: ['cena-romantica', 'tango-milonga', 'feria-gratis', 'charla-tecnologia', 'feria-libros'],
    note: 'Neighborhood browse: all known Palermo events pass, other neighborhoods excluded.',
  },
  {
    query: 'planes en san telmo',
    relevant: ['cena-romantica', 'tango-milonga'],
    irrelevant: ['techno-fabrik', 'yoga-palermo', 'brunch-domingo'],
    note: 'Spanish neighborhood browse.',
  },
  {
    query: 'romantic dinner in san telmo',
    relevant: ['cena-romantica'],
    irrelevant: ['techno-fabrik', 'maraton', 'charla-tecnologia'],
    top: 'cena-romantica',
    note: 'Date signal + neighborhood constraint combine.',
  },
  {
    query: 'techno party saturday',
    relevant: ['techno-fabrik'],
    irrelevant: ['cena-romantica', 'maraton', 'charla-tecnologia'],
    top: 'techno-fabrik',
    note: 'Techno + weekday signals; the Saturday techno night ranks first.',
  },
]
