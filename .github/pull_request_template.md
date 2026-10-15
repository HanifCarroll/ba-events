Describe the problem and resulting behavior.

Validation: commands, tested commit and relevant results.

For AI changes, use [the release checkpoint](../docs/ai-release-checklist.md):

Release decision: `reviewed_quality_accepted`, `no_ai_behavior_change`,
`owner_approved_operational_exception`, or `blocked`.

Evidence/receipt: <!-- Tested commit, frozen corpus/report hashes and rollback. -->
Owner acceptance: <!-- Quality approval or an operational exception needs the release-specific approval and date. -->

- [ ] Deterministic checks pass; required specs are current.
- [ ] AI behavior impact and the release decision above have matching evidence; any operational exception has release-specific owner approval.
- [ ] Original failures and missing labels remain visible.
- [ ] Migration, deployment and rollback receipts identify the intended release.

Mark each applicable item complete before merge; explain any inapplicable item.
Deferred human review is not a passing quality gate or a standing release exception.
