# Reasoning Boundary

Case: `crwa-mobile-onboarding-dialog`
Provider: `anthropic-messages-api`
Live model used: `yes`
Model: `claude-opus-4-7`
Request id: `req_011CaSTXBAAadx5QG7ahq7xF`
Latency: `13234ms`
Usage: `input 1100 / output 790`
Intended model boundary: `claude-code-or-anthropic-api`

This recorded run used the Anthropic Messages API to generate the reasoner diagnosis from summarized evidence artifacts.

## Truth Boundary

The reasoner proposes and explains. Deterministic verification, doctor, run timeline, and scorecard decide acceptance.

## Evidence References

- `./artifacts/crwa-mobile-onboarding-dialog/failure.png`
- `./artifacts/crwa-mobile-onboarding-dialog/trace.zip`
- `./artifacts/crwa-mobile-onboarding-dialog/console.ndjson`
- `./artifacts/crwa-mobile-onboarding-dialog/network.ndjson`
- `./artifacts/crwa-mobile-onboarding-dialog/ax-tree.json`
- `./artifacts/crwa-mobile-onboarding-dialog/dom-snapshot.json`
- `./artifacts/crwa-mobile-onboarding-dialog/candidates.json`
- `./artifacts/crwa-mobile-onboarding-dialog/patch.diff`
- `./artifacts/crwa-mobile-onboarding-dialog/verify.json`

## Top Source Candidate

- `src/containers/UserOnboardingContainer.tsx` score `475`
- Matches data-test hooks found in the captured DOM.
- File path/name matches the case vocabulary.

## Diagnosis

- Symptom: On iPhone 13 viewport (390x844) at /signup, a newly created user's onboarding dialog renders with its content and action row overflowing horizontally beyond the viewport.
- Likely root cause: The onboarding dialog in src/containers/UserOnboardingContainer.tsx (top candidate, matching captured DOM data-test hooks) likely uses a fixed width or non-responsive layout for its content/action row (e.g., a fixed min-width, large padding, or a Dialog/Button row without flex-wrap or max-width: 100%), causing horizontal overflow at narrow mobile widths.
- Patch hypothesis: Constrain the dialog within the viewport by setting a responsive max-width (e.g., maxWidth="xs" or width: 100% with boxSizing) on the Dialog/Paper, and allow the action row to wrap (flex-wrap: wrap) or shrink (min-width: 0) inside UserOnboardingContainer.tsx, so both the content text and DialogActions buttons fit within 390px.

## Verification Plan

- Reload /signup at 390x844 as a new user and confirm the onboarding dialog is fully visible with no horizontal scroll.
- Check that document.scrollingElement.scrollWidth <= viewport width while the dialog is open.
- Verify the action row buttons remain tappable and wrap rather than clipping.
- Re-run at a wider viewport (e.g., 1280px) to confirm no regression in desktop layout.
- Inspect verify.json/patch.diff outputs to confirm the change is scoped to UserOnboardingContainer.tsx.

## Residual Risks

- Other dialogs sharing the same Dialog/Paper styles could be affected if global styles are changed instead of local ones.
- Wrapping the action row may alter button order/visual hierarchy on small screens.
- Console errors (6) and xstate transient-transition warnings are unrelated here but may mask other onboarding state issues.
- Screenshot alone cannot confirm exact overflow source; runtime inspection of computed styles is needed.
- Fix may not address overflow if it originates from a child component (e.g., TransactionItem) embedded in the dialog.
