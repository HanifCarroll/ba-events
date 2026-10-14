# Agent architecture baseline

Section 2 of the applied AI work checklist requires a quality baseline before
adding agents, tools or model stages. Contract checks and model-quality judgments
are separate evidence. Passing an execution test cannot establish that a response
is accurate or useful, and a model grader cannot certify its own calibration.

## BA Eventos

Description provenance varies: some stored bilingual descriptions retain native
provider text, while other imports store AI-extracted semantic text and its
translation. "Complete originals" in the description-projection checkpoint
means complete stored description columns, not independent raw provider evidence.
The concierge's card/source support checks do not establish enrichment fidelity
or real-world event existence. Section 5's source controls compare production
enrichment directly with supplied page text; independent review remains separate.

The baseline exercises the existing production turn preparation and orchestration
on eight English/Spanish conversations, three independent trials each, with nine
synthetic events and a fixed Buenos Aires clock. Cases cover clarification,
constraint refinement, ordinal references, details, directions and abstention.
The corpus fingerprint is
`ab7bb15487dbd373ff093cb411a4e4bf2e22f62eca63e4db8889e82880c25a6d`.
Fixtures and deterministic graders remain unchanged between comparisons.

The historical evidence run `92b76bcc-1528-4cb7-bf5a-cae716f9409b` passed 24/24
conversations and 72 turns. Its latest quality report's source-report fingerprint
was verified against the original bytes on October 13, 2026. Its corpus and case
fingerprints still match the current suite; its orchestration fingerprint does
not match today's implementation. It therefore describes the recorded version,
rather than establishing today's quality.

The refreshed run `1287e549-6745-43fe-8815-b9c090184f98` completed all 24 trials
and 72 turns with the unchanged corpus, cases and deterministic graders. Its
orchestration fingerprint matches current code. The automatic result is 23/24
conversations: `newest-list-es`, trial 2, turn 1 failed the language heuristic.
The saved response is “Dale, buscamos noches gratis por Palermo y aparecieron
tres opciones.” Inspection identifies Spanish despite the heuristic's English
classification. Retain the automatic failure and this diagnostic separately;
do not silently rewrite the score or tune a grader on this holdout and call the
regraded result independent validation.

The bilingual replacement uses [franc](https://github.com/wooorm/franc) with the
English/Spanish language set. A separate, untouched
[PUD test corpus](https://universaldependencies.org/conll17/) validation selected
100 sentences per language (40–160 characters, deterministic sentence-ID hash
order) from the pinned UD r2.17 English/Spanish PUD files. It measured 99% agreement
for each language, above the declared 90% minimum. Receipt:
`results/evals/concierge/language-pud-validation-20261013.json`. This is a language
classifier check, not human calibration of factuality or usefulness. It does
not certify third-language detection, mixed-language replies or very short text.
An earlier unrestricted-language diagnostic is retained separately and was not
used as the final validation set.

Rescoring the same saved responses with evaluator v2 passes 24/24 conversations
without any additional model calls. The source report and its original 23/24
scores remain unchanged; a separate `.language-v2-rescore.json` records the parent
report fingerprint and detector version. Future experiments record the new
evaluator/detector versions. Server reads verified all 24 original Langfuse
traces, exact conversation/turn scores and generation parentage/counts, including
the original failed score. The verification receipt is saved alongside the run.

Subsequent Section 3 work changes the model-facing representation of time-TBA
events to date-only starts and null end times, masks stored hidden/unconfirmed
venue addresses, scopes event-owned venue handles, and aligns zero-price free
status with card presentation. The retained run and human-review
packet describe the earlier evaluated code; they are not evidence that this
new version was model-evaluated. Focused regressions verify the representation
and Buenos Aires date conversion. Reuse the existing suite at the next release
or substantive prompt/model comparison rather than generating a new paid run
for this deterministic projection change.

Section 4's later prompt comparison retains two bilingual cases with two trials
each before and after shortening tool descriptions. Both arms pass all four
trials; provider first-step input falls by 571 tokens/about 15%. This comparison
does not refresh the full eight-case baseline or calibrate prose.

Dialogue now retains a contiguous recent suffix capped at twelve messages,
2,000 characters per message and 6,000 characters overall. Current requests and
server-owned references/previous search constraints stay separate. The runner
records an observed per-request context budget of 16,000 input tokens across
instructions, schemas, messages and tool results; after an observed overshoot,
it prevents another model step and preserves successful reads through the normal
fallback. The completed request itself may exceed the budget. Character caps
are not token counts, and this is not a strict preflight tokenizer-based limit.

A stress run seeds 24,000 characters of old dialogue into the existing English
ordinal/details/directions and Spanish refinement/newest-list cases. Both
independent trials per case pass (12 turns). Captured history stays within 6,000
characters; peak provider input is 4,807/5,368 tokens respectively. Receipt:
`results/evals/concierge/history-budget/receipt.json`. These are bounded context
contract checks; independent prose calibration and full-suite release gates
remain separate.

The refreshed provisional prose report
`1287e549-6745-43fe-8815-b9c090184f98.quality-2847f903-54f2-4ecb-b349-96f6b97f5762`
completed 68/72 turns with four grading errors and eight invalid attempts. Its
38-example blinded packet uses the fresh responses and existing diagnostic
controls. The rubric remains uncalibrated; neither exported scores nor model
judgments count as independent human labels.

That report's uncalibrated grader completed 69/72 turns, retaining three grading
errors and six invalid attempts. These are protocol failures, not correct
responses or confirmed product failures. The existing blinded 38-example review
packet remains available under ignored `results/evals/concierge/`. Independent
labels and class/language coverage are still required under the readiness rules
in [concierge quality](concierge-quality.md). Keep its comparison key hidden from
the reviewer. Preserve the original reports when refreshing the baseline.

The production authority boundary exposes exactly seven declared read/framing
tools and no save/unsave mutation. Execution permits at most eight tool calls,
five model steps, seven seconds per read, twenty seconds per model step and sixty
seconds overall. Sequential and parallel excess-call tests verify that the ninth
and tenth calls never invoke the business reader. Existing tests verify unknown
references fail closed, structured cards derive from successful server reads,
and cancelled or late reads cannot publish artifacts. SDK cancellation tests
exercise the actual model transport. These are local boundary checks; deployed
channel cancellation and recovery remain Section 9 work.

## Casamo

The October 13 review report
`results/model-evals/review-2026-10-13T18-44-12-361Z.json` completed six diagnostic
cases with no false positives or misses. Its recorded fixture SHA-256 still
matches `tests/fixtures/model_evals/review_cases.jsonl`. It contains no complete
evaluated-source fingerprint, so it cannot prove current source equivalence.
These review cases and the separate labeled photo corpus assess narrow audits.
They cannot establish whole-scan decision correctness or traveler usefulness.

The offline investigation replay exercises production planning, assessment and
report projection on captured synthetic sources, including cold/warm resumes,
exact unit/offer identity and missing-evidence handling. It forbids network work
and does not substitute a historical final verdict for acquired evidence.
Synthetic timings prove scheduling behavior, not production latency or costs.

Fresh local verification covers 67 native tests across contracts, evidence,
coverage, planning, admission, replay, assessment, qualification and registry
boundaries, plus 44 Cloudflare storage/workflow tests. The latter exercise actual
D1/R2/Workflow boundaries with controlled external responses: duplicate-owner
fencing, scoped attachments, expired/cancelled work, shared and per-scan capacity,
bounded attempts, stale publication and exactly-once terminal outcomes.

Current policy version 11 admits 25 active properties with a 100-property
reservoir, three application attempts and three infrastructure recoveries, a
two-minute action lease, and a one-hour investigation cutoff. The 150-listing
value bounds discovery waves, not cumulative admission. Model requests have a
separate two-minute timeout. Permits and action revisions are enforced from the
captured policy; provider/model text cannot authorize arbitrary capabilities.
Production cancellation verification remains Section 9 work.

Casamo's remaining baseline preparation needs source-preserving whole-scan
holdouts and blinded independent decision labels, with provider, source mode,
required/preferred criteria and evidence-availability coverage. Preserve existing
goldens byte-for-byte. The acceptance dimensions and denominators are defined in
`/Users/hanifcarroll/projects/casamo/docs/product/scan-quality.md`.

## Completion boundary

Leave the full baseline unchecked until independent labels, adequate coverage
and current evaluated-source receipts exist. Retain errors and all repeated
trials. Record authority/limit checks as local verification separately; they do
not certify a calibrated baseline or a production rollout. Compare future
architecture changes on the same frozen inputs and label revision before adding
new agents, tools or model stages.
