# Concierge quality and task outcomes

## Task success

A recommendation succeeds when the requested number of options comes from
credited successful reads, satisfies the user's hard constraints, has explicit
source evidence for the requested activity, and includes accurate, useful prose.
A card click or save is a separate engagement signal, not proof of factuality.
Optional completed-web-response helpfulness ratings add direct user feedback.
See `docs/analytics.md` for coverage, latest-vote and engagement denominators.
These ratings measure perceived usefulness, not independent factual correctness.

An ordinal follow-up succeeds when it resolves the requested option in the actual
newest displayed list and provides the requested details or directions. Changing
neighborhood, budget or another constraint in a new user turn is a refinement;
silently broadening an empty search within a turn is a failure.

An empty-result response succeeds when it accurately reports the searched scope
and helps the user refine it. It cannot claim that no such events exist anywhere.
Clarification succeeds when a reference is genuinely ambiguous. Missing source
descriptions require an honest limitation; they do not justify inferring activity
from titles, categories, venues or enrichment facets. A recommendation mismatch
is a successful abstention when no inspected description confirms the criterion.

Saving, unsaving and sharing are controlled by the product's card controls; the
concierge remains read-only. Out-of-scope requests receive a brief events redirect.

## Failure categories

| Category | Examples | Evidence |
| --- | --- | --- |
| Execution | Model/tool failure, timeout, fallback | Run outcome and traces |
| Authority | Unsupported card, mutation, unknown handle | Canonical provenance and read ledger |
| Reference | Wrong ordinal, stale result list | Actual preceding canonical response |
| Constraints | Dropped budget, free status, neighborhood or date | Every attempted canonical search intent |
| Existence | Displayed event absent from credited read | Server read identifiers |
| Suitability | Source does not establish requested activity | Exact description evidence and user request |
| Factuality | Invented price, date, location, performer or availability | Exact model-visible successful read/active state |
| Explanation | Personalized reason overstates the evidence | Each visible recommendation reason |
| Usefulness | Wrong task, misleading answer, unnecessary clarification | Request, history, prose and trusted cards together |
| Data | Stale or incomplete source inventory | Source freshness/completeness; separate retrieval evaluation |
| Grading | Missing evidence, invalid citation, judge request failure | Quality evaluator error; never counted as a passing answer |

## Prose grading

`bun run eval:concierge:multi --trials 3 --langfuse` captures production model
instructions, actual bounded messages and public tool results in the ignored
evaluation report. It never captures model reasoning or credentials. The live
application does not persist this eval-only evidence. Older reports without
evidence cannot be graded by reconstructing their sources from displayed cards.

```sh
bun run eval:concierge:judge-controls
bun run eval:concierge:quality --report /absolute/path/to/model-run.json --langfuse
```

The judge uses the configured DeepSeek endpoint and `AI_EVAL_JUDGE_MODEL` (default:
the configured app model). `--model` overrides it for the quality command. Its
configuration, actual returned model, response identity, usage, rubric hash and
input-report hash are recorded. The same default model can share the app model's
biases; these scores remain **uncalibrated** until human agreement is measured.
Fourteen developer-authored controls exercise invented prices, absent description
evidence, genre mismatch, supported/invented explanations and attempts to
manipulate the evaluator in both languages. They are diagnostic
expectations, not human labels.

Existence is a deterministic provenance score. Factuality is 0/1 across extracted
prose claims; every supported claim needs a source identifier that resolves to
an exact captured value. The judge selects existing identifiers instead of
retyping JSON paths or quotations. Invalid references still fail validation,
and a reason cannot cite another event's evidence. Semantic entailment remains
the judge's responsibility and requires independent human calibration. Suitability
and usefulness use 0/1/2; explanation accuracy uses 0/1. Non-applicable scores
remain null, with coverage reported separately. Grading errors remain errors.
The provisional quality command fails on any contract failure, applicable score
below its required value (1 for binary scores, 2 for ordinal scores), missing or
invalid grade, or requested export failure. It is not yet a calibrated CI gate.
The judge may repair a structurally invalid response once, against the same
captured data. Every rejected attempt is retained, with its usage and response
identity when available. Valid low scores are never retried. Reports distinguish
invalid attempts from final grading errors, so repair does not erase reliability
problems or choose the best model-quality result. API/structured-output failures
remain errors rather than invented grades.
Optional Langfuse scores use a `provisional_turn_` prefix on the original
conversation trace. They cannot overwrite the existing deterministic scores.
Every turn also gets a grading-completeness score, including a zero on errors.
Claims about executed searches can cite their actual search inputs; claims about
real-world events require the returned event fields. A model-authored mismatch
reason echoed by a tool is not independent evidence for its own accuracy.

## Human calibration

Langfuse recommends comparing judge predictions against independently supplied
ground truth and inspecting disagreement, including class-specific errors:
[Langfuse calibration guide](https://langfuse.com/guides/llm-as-a-judge-calibration-skill).

```sh
bun evals/concierge/quality-review.ts --source /absolute/path/to/model-run.json \
  --quality /absolute/path/to/quality-report.json \
  --controls /absolute/path/to/judge-controls-report.json
```

This creates a local HTML review with one complete trial per conversation plus
the diagnostic controls, shuffled with opaque identifiers. Automatic grades,
case names and diagnostic expected labels are hidden. The reviewer sees the
request, actual history, visible prose/cards and supplied read evidence. The page
makes no network requests. Save a partial review and load it later to resume.
Keep the companion comparison key away from the reviewer until labeling is done.

```sh
bun evals/concierge/quality-review.ts --key /absolute/path/to/review.key.json \
  --labels /absolute/path/to/ba-eventos-human-review.json
```

The comparison rejects missing, duplicate, unknown or stale labels and requires
a human reviewer identifier. It reports exact agreement, confusion counts,
class-specific recall and English/Spanish agreement per dimension. Conversation
examples and developer diagnostic controls also get separate agreement views;
the comparison records the judged model, run and source-report fingerprint. Initial
readiness criteria are at least 24 examples, at least eight per language, at
least two non-null classes with at least two examples each, and at least 90%
overall, per-class and per-language agreement. Insufficient class coverage stays
open instead of producing an optimistic calibration claim. These starting
thresholds are project policy; the human review may reveal the need for a larger
holdout. Do not tune a judge on the final holdout and then reuse it as proof.

The full quality baseline requires completed independent human labels, adequate
dimension coverage and an unchanged judged holdout. A synthetic conversation
baseline does not establish live retrieval recall, source freshness, engagement
or customer satisfaction. Those remain separate items in the work checklist.
