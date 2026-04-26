# Bug

Capture an authenticated mobile transaction-feed state with the date range drawer open.

# Repro

- Route: `/signin`
- Viewport: `iPhone 13 (390x844)`
- Auth mode: `ui`
- Steps:
  - Open the mobile sign-in route
  - Log in with a seeded local user
  - Wait for the transaction feed
  - Open the date range filter drawer
  - Capture the resulting mobile UI state and evidence bundle

# Root Cause

The Material UI bottom drawer and calendar wrapper are not bounded to the mobile viewport, so the date picker content can extend below the screen.

- Reasoner artifact: `./artifacts/crwa-mobile-date-range-drawer/reasoner.md`
- Reasoner JSON: `./artifacts/crwa-mobile-date-range-drawer/reasoner.json`
- Evidence integrity: `./artifacts/crwa-mobile-date-range-drawer/evidence-manifest.md`
- Hypothesis artifact: `./artifacts/crwa-mobile-date-range-drawer/hypothesis.md`

# Source Localization

- Candidate artifact: `./artifacts/crwa-mobile-date-range-drawer/candidates.json`
- `src/components/TransactionDateRangeFilter.tsx` score 541: Matches data-test hooks found in the captured DOM.
- `src/components/TransactionListAmountRangeFilter.tsx` score 342: Matches data-test hooks found in the captured DOM.
- `src/components/TransactionItem.tsx` score 270: Matches data-test hooks found in the captured DOM.
- `src/components/TransactionDetail.tsx` score 249: Matches data-test hooks found in the captured DOM.
- `src/components/NavBar.tsx` score 244: Matches data-test hooks found in the captured DOM.

# Fix

Constrain the drawer paper to full viewport height and make the date-range calendar wrapper viewport-bounded and scrollable.

# Changed Files

- `src/components/TransactionDateRangeFilter.tsx`
- Patch: `./artifacts/crwa-mobile-date-range-drawer/patch.diff`

# Before Evidence

- Screenshot: `./artifacts/crwa-mobile-date-range-drawer/failure.png`
- Negative control: `./artifacts/crwa-mobile-date-range-drawer/before-verify.json`
- Trace: `./artifacts/crwa-mobile-date-range-drawer/trace.zip`
- Console: `./artifacts/crwa-mobile-date-range-drawer/console.ndjson`
- Network: `./artifacts/crwa-mobile-date-range-drawer/network.ndjson`

# After Evidence

- Screenshot: `./artifacts/crwa-mobile-date-range-drawer/success.png`
- Verification: `./artifacts/crwa-mobile-date-range-drawer/verify.json`
- Validation dossier: `./artifacts/crwa-mobile-date-range-drawer/index.html`

# Verification

- Models advise, verifiers decide.
- Agents create diffs. Forensic Repo Surgeon creates inspectable proof.
- Proof scorecard: `./artifacts/crwa-mobile-date-range-drawer/scorecard.json`
- Run timeline: `./artifacts/crwa-mobile-date-range-drawer/run.json`
- Before-state verification status: `failing`
- Expected before-state failures observed: `calendar starts near top of the mobile viewport`
- Verification status: `passing`
- pass: date range drawer is visible
- pass: drawer close button is visible
- pass: calendar container is within the mobile viewport
- pass: calendar starts near top of the mobile viewport
- pass: no unexpected console errors appear during drawer verification
- The user can authenticate through the local app
- The transaction feed is visible
- The mobile date range drawer or calendar is visible
- Trace, screenshot, AX tree, and DOM snapshot are present

# Residual Risk

Desktop popover behavior should be reviewed before upstreaming. Adjacent mobile viewport sizes are not exhaustively checked. Anthropic error: Unterminated string in JSON at position 2500
