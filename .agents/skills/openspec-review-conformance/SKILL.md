---
name: openspec-review-conformance
description: Run a read-only, citation-based advisory review of BA Events OpenSpec requirements against implementation and deterministic tests.
allowed-tools: Bash(openspec:*), Bash(rg:*), Bash(git:*), Read
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: ba-events
  version: "1.0"
---

Run a repeatable, read-only conformance review for the named spec, requirement,
change, or file. If scope is omitted, use the affected specs from the current
working-tree diff and state that choice.

1. Read the applicable repository instructions, `openspec/config.yaml`, the
   in-scope requirements and scenarios, their implementation anchors, and their
   deterministic tests.
2. Follow callers where needed. Do not infer behavior from file or symbol names.
3. Report `Contradictions`, `Undocumented behavior`, and `Missing evidence`.
   Say `No findings` for an empty category.
4. Every finding must cite the requirement or scenario and exact code/test file
   lines, or the nearest stable symbol when line ranges are unavailable.
5. Finish with a compact coverage table containing requirement/scenario,
   implementation citation, test citation, status, and confidence.
6. Distinguish direct evidence from inference and disclose unavailable runtime,
   generated, database, or external evidence.

Do not edit code, tests, specs, or configuration during this review. Validate
structure separately with `openspec validate --specs --json`. AI review is
advisory and never replaces validation, tests, or observed runtime behavior.
