# Repair Hypothesis

Case: `crwa-mobile-onboarding-dialog`

## Evidence Read

- Before screenshot: `./artifacts/crwa-mobile-onboarding-dialog/failure.png`
- Browser trace: `./artifacts/crwa-mobile-onboarding-dialog/trace.zip`
- DOM snapshot: `./artifacts/crwa-mobile-onboarding-dialog/dom-snapshot.json`
- Accessibility tree: `./artifacts/crwa-mobile-onboarding-dialog/ax-tree.json`

## Localization Hypothesis

The highest-confidence source candidate is `src/containers/UserOnboardingContainer.tsx` with score `475`.
- Matches data-test hooks found in the captured DOM.
- File path/name matches the case vocabulary.

## Root-Cause Hypothesis

The onboarding dialog in src/containers/UserOnboardingContainer.tsx (top candidate, matching captured DOM data-test hooks) likely uses a fixed width or non-responsive layout for its content/action row (e.g., a fixed min-width, large padding, or a Dialog/Button row without flex-wrap or max-width: 100%), causing horizontal overflow at narrow mobile widths.

## Patch Hypothesis

Constrain the dialog within the viewport by setting a responsive max-width (e.g., maxWidth="xs" or width: 100% with boxSizing) on the Dialog/Paper, and allow the action row to wrap (flex-wrap: wrap) or shrink (min-width: 0) inside UserOnboardingContainer.tsx, so both the content text and DialogActions buttons fit within 390px.

Changed files:
- `src/containers/UserOnboardingContainer.tsx`

## Verification Evidence

- Before-state negative control: `passing`
- Verification status: `passing`
- pass: onboarding dialog is visible
- pass: logout button is visible
- pass: next button is visible
- pass: logout button is within the mobile viewport
- pass: next button is within the mobile viewport
- pass: logout button uses mobile touch width
- pass: next button uses mobile touch width
- pass: onboarding action buttons do not overlap
- pass: onboarding step one does not introduce horizontal overflow
- pass: no unexpected console errors appear during onboarding verification

## Truth Boundary

This hypothesis is not proof by itself. The proof is the passing verification artifact plus the before/after browser evidence.
- Residual risk: Other dialogs sharing the same Dialog/Paper styles could be affected if global styles are changed instead of local ones.
- Residual risk: Wrapping the action row may alter button order/visual hierarchy on small screens.
- Residual risk: Console errors (6) and xstate transient-transition warnings are unrelated here but may mask other onboarding state issues.
- Residual risk: Screenshot alone cannot confirm exact overflow source; runtime inspection of computed styles is needed.
- Residual risk: Fix may not address overflow if it originates from a child component (e.g., TransactionItem) embedded in the dialog.
