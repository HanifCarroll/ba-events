# AI release checkpoint

Use the existing [Workers Builds gate](cloudflare-workers-builds.md) and eval
adapter. Record this checkpoint in the PR before merging. The automated gate
checks code and deterministic contracts; AI-quality approval is a manual merge
checkpoint owned by the project owner.

## Required release decision

Record one decision in every AI-related PR. A blank decision or `blocked` leaves
the manual merge checkpoint incomplete.

| Decision | Required evidence |
| --- | --- |
| `reviewed_quality_accepted` | Matching frozen eval, independent labels, retained failures and dated owner acceptance. |
| `no_ai_behavior_change` | Evidence that model requests, retrieval, grounding and results are unchanged; relevant deterministic checks. |
| `owner_approved_operational_exception` | Exact release-specific owner approval, bounded operational scope, remaining quality risks and rollback. |
| `blocked` | Missing checks, approval, compatible data/rollback or a required quality decision. |

The owner deferred human review. Independent factuality/usefulness and grader
calibration remain unknown, and that deferral does not approve future model,
prompt or retrieval changes. Frozen-example and documentation additions can be
`no_ai_behavior_change` when they alter no runtime behavior. Retain all original
failed diagnostics and separate automatic scores from independent review.
This is the existing manual PR gate, not enforced branch protection or a new CI
platform. An operational exception applies only to the release it names.

## Before merge

- Identify whether the change affects prompts, selected models, context/output
  limits, retrieval, grounding or audit decisions. Record the affected paths.
- Run the relevant deterministic checks. At the release checkpoint, run the
  existing clean-checkout gate, including both test runners and the production
  build. Earlier green checkpoints retain their date and commit; focused checks
  on later changes do not make an old full-suite result a current-head result.
- For an AI behavior change, attach the existing frozen-corpus repeated-trial
  report with code, prompt/configuration, selected/returned model, corpus and
  measurement identities. Retain every trial, failure and diagnostic rescore.
- Record quality review and unresolved labels. Missing labels, a model grader's
  own score or a routing pass cannot establish reviewed factuality/usefulness.
  Keep the quality approval open until the owner accepts the relevant evidence.
- For a tracing-only change, record why model requests/results are unchanged
  and attach exporter/privacy/failure checks. That exception does not cover
  changes to orchestration limits, retrieval or grounding in the same PR.
- Apply required migrations in the declared order, verify their actual behavior,
  and record the backup/rollback boundary. Keep credentials and source captures private.
- Record staging/production checks separately. A bundle dry run or accepted
  export cannot establish a deployed request, trace read visibility or user outcome.

## Release receipt

Copy these fields into the private release record and summarize them in the PR:

| Field | Evidence |
| --- | --- |
| Code | Git commit and relevant SDK/lockfile revision |
| Prompt/configuration | Prompt revision, configuration fingerprint and limits |
| Model | Selected alias, returned identity and recorded thinking/transport mode |
| Corpus | Corpus/case hashes, frozen clock and trial count |
| Results | Report path/hash, original failures, review and acceptance decision |
| Checks | Commands, exit outcomes, observation date and tested commit |
| Data changes | Migration names/order, backup receipt and compatibility boundary |
| Deployment | Workers Build ID, deployed Worker version IDs and smoke-test results |
| Rollback | Previous Worker version IDs, preserved secrets and migration strategy |

The deployment sequence remains Telegram, MCP, application, then chat delivery.
Trigger.dev is a separate import release. Before deploying, record the previous
versions for every Worker being changed. Restore compatible versions in reverse
order if rollback is required. Preserve the paid-filter correction and additive
provenance column when reverting application code; do not drop captured data as
part of a code rollback.

## Recorded releases

Tracing and its redaction correction, paid-filter/provenance migrations,
token-cost exports, cancellation cleanup and replay network URL correction are
released. The replay correction is recorded at
`932295e4c106a22f3535032ed20e17f54b517ce1`; the separately recorded cancellation
trace fix is `85399349aaa9c2cad1b89916a37d3c090f18f00f`. Their original checks,
deployed versions and observations remain distinct. The October 15 scheduled
import confirms all six catalog provenance records and fresh enrichment rows;
two source-description gaps remain explicit.

Private `results/releases/ai-reproducibility-20261015/index.json` fingerprints and
links code/check, prompt/configuration, model, frozen corpus/results, migration,
deployed observation and rollback receipts. It preserves original observation
dates and historical unknowns instead of certifying the current dirty worktree
or a newer deployment. Independent quality review/calibration remain deferred;
operational acceptance is separate from reviewed-quality acceptance. Unsupported
Telegram lifecycle/fault and deployed limiter-outage checks stay open.

This publication changes the release documentation and PR template only. It
changes no model requests, application behavior, tests, credentials or data.
The private reproducibility index retains historical receipt dates and unknowns;
publishing the checklist does not create new independent quality approval.
