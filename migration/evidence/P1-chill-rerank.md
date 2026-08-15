# P1 — chill soft ranking — evidence

Card: `migration/cards/P1-chill-rerank.md`
Worker: `P1-chill-rerank`

## Summary

Chill asks ("chill / tranquilo / relaxed") now soft-rerank search results:
relaxed / low-energy events rise, parties and high-energy events sink, and
untagged events keep their relative order. This is ranking only — no event is
ever dropped, and no SQL filter was added.

Files touched (all within the card's boundaries):

- `src/features/chat/api/tools/search-intent.ts` — added `detectChillIntent`
- `src/features/chat/api/tools/search-intent.test.ts` — added `detectChillIntent` cases
- `src/features/chat/api/tools/quality-diversity.ts` — extended `SearchScoreable`, added `chillRerank`
- `src/features/chat/api/tools/quality-diversity.test.ts` — created
- `src/features/chat/api/tools/search-events.ts` — wired the rerank on semantic + `now` paths
- `src/features/chat/api/tools/search-events.test.ts` — added a `query: 'chill'` semantic rerank case

## 1. Intent detection (token set only, no substring matching)

`detectChillIntent(semanticQuery)` normalizes (lowercase, accent-strip) and
splits into tokens, then matches whole tokens against:

```
chill, tranqui, tranquilo, tranquila, relajado, relajada,
relaxed, lowkey, low-key, calmado, suave
```

`low-key` is matched as the adjacent normalized pair `low key` because
`normalizeText` turns the hyphen into a space. No substring matching — `cita`
in `recital` and `chill` in `chillout` both stay false.

## 2. Score table (`chillRerank`, higher first)

| Signal | Score |
| --- | --- |
| `facets.vibes` includes `relaxed` or `intimate` | `+2` |
| `facets.energy === 'low'` | `+2` |
| `facets.eventType` includes `class` or `exhibition` | `+1` |
| `facets.eventType` includes `party` | `-3` |
| `facets.energy === 'high'` | `-2` |
| `facets.vibes` includes `energetic` | `-1` |
| `facets` missing / `null` / empty | `0` |

Sort is stable (`Array.prototype.sort`), so ties keep the retrieval order, and
untagged events only move relative to tagged neighbours with non-zero scores.

## 3. Wiring

- Semantic path: after `hybridEventSearch`, before `applyDiversity` / slice:
  `if (detectChillIntent(query)) candidates = chillRerank(candidates)`.
- `timeFilter === 'now'` path (non-surprise): same helper applied to the
  in-memory `nowEvents` before diversity / slice.
- Surprise and filter-only paths: unchanged.

## 4. Quoted test — party loses to relaxed, nothing dropped

From `src/features/chat/api/tools/quality-diversity.test.ts`:

```ts
it('puts a relaxed-low event before untagged and party-high', () => {
  const out = chillRerank([partyHigh, untaggedMissing, relaxedLow])
  expect(out.map((e) => e.id)).toEqual(['relaxed-low', 'untagged-missing', 'party-high'])
})

it('does not drop any event (ranking, not filtering)', () => {
  const input = [partyHigh, untaggedMissing, relaxedLow]
  const out = chillRerank(input)
  expect(out).toHaveLength(input.length)
  // The party loses to the relaxed event but is still present.
  expect(out.map((e) => e.id)).toContain('party-high')
  expect(out.map((e) => e.id)).toContain('relaxed-low')
})
```

Fixtures: `party-high` = `{ vibes: ['energetic'], energy: 'high', eventType: ['party'] }`
(scores `-3 -2 -1 = -6`); `untagged-missing` = no `facets` (scores `0`);
`relaxed-low` = `{ vibes: ['relaxed'], energy: 'low', eventType: ['class'] }`
(scores `+2 +2 +1 = +5`).

## 5. Acceptance checks (actually run)

### 1. `bunx vitest run src/features/chat/api/tools`

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events

 Test Files  4 passed (4)
      Tests  80 passed (80)
   Start at  16:28:08
   Duration  805ms (transform 218ms, setup 0ms, import 2.10s, tests 34ms, environment 1ms)
```

### 2. `bunx tsc --noEmit`

Zero errors (no output, exit 0).
