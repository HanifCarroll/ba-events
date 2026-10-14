# AI release checkpoint

Use the existing [Workers Builds gate](cloudflare-workers-builds.md) and eval
adapter. Record this checkpoint in the PR before merging. The automated gate
checks code and deterministic contracts; AI-quality approval is a manual merge
checkpoint owned by the project owner.

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
  and attach exporter/privacy/failure checks. The current release also changes
  orchestration limits and retrieval, so that exception does not cover the whole PR.
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

## Current draft

[PR #6](https://github.com/HanifCarroll/ba-events/pull/6) is open and undeployed.
The prepared full gate predates later focused fixes. Current-head release checks,
Supabase migrations/access, applicable quality acceptance
and deployed smoke checks remain open. The owner chose content with redaction;
local export checks pass, while deployed payload verification remains open. Historical baseline receipts remain
diagnostic evidence for their recorded code/configuration.
