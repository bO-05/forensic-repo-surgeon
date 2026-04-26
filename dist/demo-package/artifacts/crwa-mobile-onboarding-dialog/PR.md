# Bug

Capture a newly created mobile user's onboarding dialog where the action row and content can overflow horizontally.

# Repro

- Route: `/signup`
- Viewport: `iPhone 13 (390x844)`
- Auth mode: `none`
- Steps:
  - Open the mobile sign-up route
  - Create a brand-new local user through the UI
  - Sign in with that user on the same viewport
  - Wait for the onboarding dialog to appear at step one
  - Capture the resulting mobile UI state and evidence bundle

# Root Cause

The onboarding dialog in src/containers/UserOnboardingContainer.tsx (top candidate, matching captured DOM data-test hooks) likely uses a fixed width or non-responsive layout for its content/action row (e.g., a fixed min-width, large padding, or a Dialog/Button row without flex-wrap or max-width: 100%), causing horizontal overflow at narrow mobile widths.

- Reasoner artifact: `./artifacts/crwa-mobile-onboarding-dialog/reasoner.md`
- Reasoner JSON: `./artifacts/crwa-mobile-onboarding-dialog/reasoner.json`
- Evidence integrity: `./artifacts/crwa-mobile-onboarding-dialog/evidence-manifest.md`
- Hypothesis artifact: `./artifacts/crwa-mobile-onboarding-dialog/hypothesis.md`

# Source Localization

- Candidate artifact: `./artifacts/crwa-mobile-onboarding-dialog/candidates.json`
- `src/containers/UserOnboardingContainer.tsx` score 475: Matches data-test hooks found in the captured DOM.
- `src/components/TransactionItem.tsx` score 288: Matches data-test hooks found in the captured DOM.
- `src/components/TransactionDetail.tsx` score 267: Matches data-test hooks found in the captured DOM.
- `src/components/TransactionListAmountRangeFilter.tsx` score 266: Matches data-test hooks found in the captured DOM.
- `src/components/TransactionDateRangeFilter.tsx` score 250: Matches data-test hooks found in the captured DOM.

# Fix

Constrain the dialog within the viewport by setting a responsive max-width (e.g., maxWidth="xs" or width: 100% with boxSizing) on the Dialog/Paper, and allow the action row to wrap (flex-wrap: wrap) or shrink (min-width: 0) inside UserOnboardingContainer.tsx, so both the content text and DialogActions buttons fit within 390px.

# Changed Files

- `src/containers/UserOnboardingContainer.tsx`
- Patch: `./artifacts/crwa-mobile-onboarding-dialog/patch.diff`

# Before Evidence

- Screenshot: `./artifacts/crwa-mobile-onboarding-dialog/failure.png`
- Negative control: `./artifacts/crwa-mobile-onboarding-dialog/before-verify.json`
- Trace: `./artifacts/crwa-mobile-onboarding-dialog/trace.zip`
- Console: `./artifacts/crwa-mobile-onboarding-dialog/console.ndjson`
- Network: `./artifacts/crwa-mobile-onboarding-dialog/network.ndjson`

# After Evidence

- Screenshot: `./artifacts/crwa-mobile-onboarding-dialog/success.png`
- Verification: `./artifacts/crwa-mobile-onboarding-dialog/verify.json`
- Validation dossier: `./artifacts/crwa-mobile-onboarding-dialog/index.html`

# Verification

- Models advise, verifiers decide.
- Agents create diffs. Forensic Repo Surgeon creates inspectable proof.
- Proof scorecard: `./artifacts/crwa-mobile-onboarding-dialog/scorecard.json`
- Run timeline: `./artifacts/crwa-mobile-onboarding-dialog/run.json`
- Before-state verification status: `failing`
- Expected before-state failures observed: `logout button uses mobile touch width`, `next button uses mobile touch width`
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
- The new user can sign up and sign in through the local app
- The onboarding dialog is visible on iPhone 13
- The onboarding action buttons stay inside the viewport without overlap
- The page has no horizontal overflow and the proof bundle is complete

# Residual Risk

Other dialogs sharing the same Dialog/Paper styles could be affected if global styles are changed instead of local ones. Wrapping the action row may alter button order/visual hierarchy on small screens. Console errors (6) and xstate transient-transition warnings are unrelated here but may mask other onboarding state issues. Screenshot alone cannot confirm exact overflow source; runtime inspection of computed styles is needed. Fix may not address overflow if it originates from a child component (e.g., TransactionItem) embedded in the dialog.
