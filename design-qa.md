# Quiet chat Retry: design QA

Date: 2026-10-13. Scope: selected ideation option 1, implemented in the existing production chat.

## Evidence

- Source visual truth: `/Users/hanifcarroll/.codex/generated_images/01a13569-b694-7ce1-a6c2-703987fc27a3/exec-9c04ced6-6b3e-4453-8118-e1ec54356843.png` (1983 x 793 pixels).
- Production desktop: `/Users/hanifcarroll/.codex/visualizations/2026/10/13/01a13569-b694-7ce1-a6c2-703987fc27a3/retry-polished-desktop.jpg` (1280 x 720 pixels, matching CSS viewport, density 1).
- Focused comparison: `/Users/hanifcarroll/.codex/visualizations/2026/10/13/01a13569-b694-7ce1-a6c2-703987fc27a3/retry-polished-comparison-crop.jpg` (794 x 318 pixels, desktop content region).
- Mobile: `/Users/hanifcarroll/.codex/visualizations/2026/10/13/01a13569-b694-7ce1-a6c2-703987fc27a3/retry-polished-mobile.jpg` (390 x 844 pixels, matching CSS viewport, density 1).
- Keyboard focus: `/Users/hanifcarroll/.codex/visualizations/2026/10/13/01a13569-b694-7ce1-a6c2-703987fc27a3/retry-polished-focus-mobile.jpg`.
- Spanish follow-up: `/Users/hanifcarroll/.codex/visualizations/2026/10/13/01a13569-b694-7ce1-a6c2-703987fc27a3/retry-polished-spanish-mobile.jpg`.
- Deployed application: https://baeventos.com. Initial verified release: `b5c2a638-9da8-443e-a4c9-95bea22b8814`.

The generated reference is an enlarged component illustration, rather than a literal product viewport. Its 1983 x 793 canvas corresponds approximately to the 794 x 318 production crop at 2.5x scale. Source and production images were opened together in one comparison input; no reference pixels were modified. Fidelity was assessed on component-relative alignment and the existing product typography, not invented pixel precision. The live timestamp differs intentionally. Full desktop and focused captures were inspected, along with mobile and keyboard states.

## Findings

No actionable P0/P1/P2 differences in the selected component.

- Fonts and typography: existing DM Sans retained; 13px supporting text and medium-weight Retry preserve the reference hierarchy, below the unchanged question. No truncation in English or Spanish.
- Spacing and layout rhythm: question, timestamp and compact row share the right alignment. No bordered notice box, filled action or dismiss button. Retry's measured hit area is 70.48 x 44 CSS pixels on desktop and mobile.
- Colors and tokens: existing cool canvas, lavender question bubble, muted status and primary indigo action retained. Focus uses the existing primary ring.
- Image and icon fidelity: no raster assets needed; the standard Lucide RotateCw icon provides the matching thin circular arrow. The icon is hidden from assistive technology and Retry retains its text label.
- Copy: short localized stopped, failed and interrupted statuses; explicit localized Retry. English shows “Response stopped”; Spanish shows “Respuesta detenida”.
- Responsive behavior: both mobile states remain visible beside their owning questions with no horizontal overflow or composer overlap.
- Accessibility: Shift+Tab reaches Retry; its visible two-pixel focus ring was inspected and Enter activates it. The existing status/alert announcements remain. This is targeted verification, not a claim of complete accessibility conformance.

## Verification receipts

Local implementation:
- Production build passed.
- `bun run check`: Svelte 0 errors/0 warnings; Effect 0 errors/0 warnings (89 existing informational messages).
- `bunx tsc --noEmit` passed.
- OpenSpec: all 10 canonical specs valid.
- Browser lifecycle and real Cloudflare fixture checks passed, including Stop, stable retry identifiers, late completion rejection, reconnect replay, native workflow recovery and exhausted recovery's explicit Retry.

Production release:
- Live guest chat `7f177ada-2768-4d13-af7d-ccb495563cd3` exercised Stop and Retry for an English first question and a Spanish follow-up after the earlier answer.
- Both completed with one question and one assistant response per turn; original user message IDs survived Retry and no Retry notice remained after success.
- Mobile hit targets, visible keyboard focus and Enter activation passed; no captured browser console errors.
- Language and viewport overrides were restored after testing.
- Stored transcript checked read-only using the guest-chat debugging script.

## Comparison history

First visual comparison passed. No P0/P1/P2 corrections were needed after the initial implementation. The original mockup has no mobile or keyboard-focus frame; these states were checked against product requirements rather than claimed to match a nonexistent reference.

## Implementation checklist

- [x] Unboxed status row and icon-labeled text action.
- [x] Short English and Spanish copy.
- [x] Original retry identifiers, validation and recovery limits preserved.
- [x] Desktop, mobile, follow-up and keyboard checks.
- [x] Production deployment and live dogfood.

final result: passed
