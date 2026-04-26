# Repair Hypothesis

Case: `crwa-mobile-date-range-drawer`

## Evidence Read

- Before screenshot: `./artifacts/crwa-mobile-date-range-drawer/failure.png`
- Browser trace: `./artifacts/crwa-mobile-date-range-drawer/trace.zip`
- DOM snapshot: `./artifacts/crwa-mobile-date-range-drawer/dom-snapshot.json`
- Accessibility tree: `./artifacts/crwa-mobile-date-range-drawer/ax-tree.json`

## Localization Hypothesis

The highest-confidence source candidate is `src/components/TransactionDateRangeFilter.tsx` with score `541`.
- Matches data-test hooks found in the captured DOM.
- File path/name matches the case vocabulary.

## Root-Cause Hypothesis

The Material UI bottom drawer and calendar wrapper are not bounded to the mobile viewport, so the date picker content can extend below the screen.

## Patch Hypothesis

Constrain the drawer paper to full viewport height and make the date-range calendar wrapper viewport-bounded and scrollable.

Changed files:
- `src/components/TransactionDateRangeFilter.tsx`

## Verification Evidence

- Before-state negative control: `passing`
- Verification status: `passing`
- pass: date range drawer is visible
- pass: drawer close button is visible
- pass: calendar container is within the mobile viewport
- pass: calendar starts near top of the mobile viewport
- pass: no unexpected console errors appear during drawer verification

## Truth Boundary

This hypothesis is not proof by itself. The proof is the passing verification artifact plus the before/after browser evidence.
- Residual risk: Desktop popover behavior should be reviewed before upstreaming.
- Residual risk: Adjacent mobile viewport sizes are not exhaustively checked.
- Residual risk: Anthropic error: Unterminated string in JSON at position 2500
