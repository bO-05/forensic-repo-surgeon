# Reasoning Boundary

Case: `crwa-mobile-date-range-drawer`
Provider: `deterministic-fallback`
Live model used: `no`
Model: `n/a`
Request id: `n/a`
Latency: `n/a`
Usage: `input n/a / output n/a`
Intended model boundary: `claude-code-or-anthropic-api`

Anthropic request failed before a valid response was returned. Deterministic fallback was used instead.

## Truth Boundary

The reasoner proposes and explains. Deterministic verification, doctor, run timeline, and scorecard decide acceptance.

## Evidence References

- `./artifacts/crwa-mobile-date-range-drawer/failure.png`
- `./artifacts/crwa-mobile-date-range-drawer/trace.zip`
- `./artifacts/crwa-mobile-date-range-drawer/console.ndjson`
- `./artifacts/crwa-mobile-date-range-drawer/network.ndjson`
- `./artifacts/crwa-mobile-date-range-drawer/ax-tree.json`
- `./artifacts/crwa-mobile-date-range-drawer/dom-snapshot.json`
- `./artifacts/crwa-mobile-date-range-drawer/candidates.json`
- `./artifacts/crwa-mobile-date-range-drawer/patch.diff`
- `./artifacts/crwa-mobile-date-range-drawer/verify.json`

## Top Source Candidate

- `src/components/TransactionDateRangeFilter.tsx` score `541`
- Matches data-test hooks found in the captured DOM.
- File path/name matches the case vocabulary.

## Diagnosis

- Symptom: Authenticated mobile transaction feed opens a date-range drawer where the calendar can be clipped outside the visible viewport.
- Likely root cause: The Material UI bottom drawer and calendar wrapper are not bounded to the mobile viewport, so the date picker content can extend below the screen.
- Patch hypothesis: Constrain the drawer paper to full viewport height and make the date-range calendar wrapper viewport-bounded and scrollable.

## Verification Plan

- Rerun the same authenticated mobile workflow.
- Assert the drawer is visible.
- Assert the drawer close button is visible.
- Assert the calendar container remains inside the 390x844 viewport.
- Capture an after screenshot and machine-readable verification report.

## Residual Risks

- Desktop popover behavior should be reviewed before upstreaming.
- Adjacent mobile viewport sizes are not exhaustively checked.
- Anthropic error: Unterminated string in JSON at position 2500
