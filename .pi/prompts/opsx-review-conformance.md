---
description: "Advisory review of OpenSpec conformance against implementation and tests"
---

Review OpenSpec conformance for the current BA Events change or affected area.

1. Identify the affected requirements in `openspec/specs/` and cite them by file
   and requirement name.
2. Compare each requirement with the implementation and deterministic tests,
   especially `src/features/chat/api/tools/search-intent.ts`,
   `src/features/chat/api/tools/search-events.ts`,
   `src/features/chat/api/tools/search-intent.test.ts`, and
   `src/features/chat/api/tools/search-events.test.ts`.
3. Report, with file and line citations where available:
   - contradictions between requirements and behavior;
   - behavior implemented but undocumented by the requirements;
   - missing or insufficient deterministic test evidence.
4. Distinguish verified behavior from an unverified gap. Do not edit product
   code, tests, or requirements as part of this review.

AI review is advisory rather than deterministic proof. The authoritative
conformance evidence is the implementation, its deterministic tests, and the
OpenSpec validation result; a review finding must not be presented as a formal
pass or proof of correctness.
