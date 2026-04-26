# Proof Evaluation

Generated: 2026-04-26T13:26:25.078Z

Mission: Evaluate whether Forensic Repo Surgeon produces visual and deterministic proof for reproducible frontend UI repairs.

Verdict: **Controlled demo proof passes, but production confidence still needs more cases, more targets, and more bug classes.**

## Summary

- Cases evaluated: 2
- Artifact-proof cases: 2
- Benchmark-ready cases: 2
- Target repos: 1
- Bug classes: 2
- Deterministic assertions: 15
- Assertion families: insideViewport, noConsoleRegression, noHorizontalOverflow, noOverlap, topWithin, visible, widthAtLeast

## Acceptance Bars

| Bar | Status | Missing |
| --- | --- | --- |
| controlled-demo | passing | none |
| production-confidence | failing | needs 5 artifact-proof cases; has 2; needs 2 target repos; has 1; needs 4 bug classes; has 2 |

## Case Results

| Case | Target | Bug Class | Proof | Benchmark Ready | Score | Assertions | Missing |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| crwa-mobile-date-range-drawer | cypress-realworld-app | responsive-viewport-clipping | passing | yes | 100 | 5 | none |
| crwa-mobile-onboarding-dialog | cypress-realworld-app | mobile-dialog-overflow | passing | yes | 100 | 10 | none |

## Known Gaps

- Current verified cases are from one target repo.
- Current runs record deterministic before-state negative controls, but only for the two locked CRWA cases.
- Current patches are tracked fixtures, so the benchmark evaluates proof packaging and verification more than autonomous patch synthesis.

## Case Notes

### crwa-mobile-date-range-drawer

- All case-level evaluation gates passed.

### crwa-mobile-onboarding-dialog

- All case-level evaluation gates passed.
