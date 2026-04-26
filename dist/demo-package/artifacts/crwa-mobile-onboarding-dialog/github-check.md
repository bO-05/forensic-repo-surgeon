# Forensic Repo Surgeon: New-user mobile onboarding dialog overflow

- Case: `crwa-mobile-onboarding-dialog`
- Conclusion: `success`
- Scorecard: `passing` score `100`
- Before-state negative control: `passing`
- Verification: `passing` (10/10 assertions passing)
- Redaction report: `./artifacts/crwa-mobile-onboarding-dialog/redaction-report.json`

## Proof Artifacts

- Scorecard: `./artifacts/crwa-mobile-onboarding-dialog/scorecard.json`
- Before verification: `./artifacts/crwa-mobile-onboarding-dialog/before-verify.json`
- After verification: `./artifacts/crwa-mobile-onboarding-dialog/verify.json`
- Before screenshot: `./artifacts/crwa-mobile-onboarding-dialog/failure.png`
- After screenshot: `./artifacts/crwa-mobile-onboarding-dialog/success.png`
- Playwright trace: `./artifacts/crwa-mobile-onboarding-dialog/trace.zip`

## Failed Gates

- none

## Residual Risks

- Other dialogs sharing the same Dialog/Paper styles could be affected if global styles are changed instead of local ones.
- Wrapping the action row may alter button order/visual hierarchy on small screens.
- Console errors (6) and xstate transient-transition warnings are unrelated here but may mask other onboarding state issues.
- Screenshot alone cannot confirm exact overflow source; runtime inspection of computed styles is needed.
- Fix may not address overflow if it originates from a child component (e.g., TransactionItem) embedded in the dialog.
