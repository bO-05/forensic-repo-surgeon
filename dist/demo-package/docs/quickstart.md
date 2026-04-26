# Quickstart

## Install

```bash
pnpm install
pnpm verify:source
```

`verify:source` typechecks the controller repo and validates the case definitions. It does not run the browser target.

## Prepare The Target

```bash
pnpm surgeon target setup
```

Default external target root:

```text
./.surgeon-targets
```

Override it in `.env.local` or the shell:

```text
SURGEON_TARGET_ROOT=/path/to/forensic-repo-surgeon-targets
SURGEON_TARGET_REPO=/path/to/forensic-repo-surgeon-targets/cypress-realworld-app
SURGEON_TARGET_LOG_DIR=/path/to/forensic-repo-surgeon-targets/logs
```

## Run The Verified Demo

```bash
pnpm demo
```

Open:

```text
dist/demo-package/artifacts/index.html
```

Useful generated files:

- `artifacts/crwa-mobile-date-range-drawer/index.html`
- `artifacts/crwa-mobile-date-range-drawer/PR.md`
- `artifacts/crwa-mobile-date-range-drawer/scorecard.json`
- `artifacts/crwa-mobile-date-range-drawer/before-verify.json`
- `artifacts/crwa-mobile-date-range-drawer/verify.json`
- `artifacts/crwa-mobile-date-range-drawer/reasoner.md`
- `artifacts/evals/proof-evaluation.md`
- `dist/demo-package/package-integrity.md`

The current expected evaluation result is that the controlled-demo bar passes and production-confidence fails until more cases, another target repo, and more bug classes are added.

## Live Opus Reasoner

```bash
cp .env.example .env.local
```

Set:

```text
ANTHROPIC_API_KEY=...
SURGEON_REASONER_PROVIDER=auto
SURGEON_REASONER_MODEL=claude-opus-4-7
```

Run:

```bash
pnpm demo:live-opus
```

`.env.local` is ignored by git and is not copied into exported proof packages.

## Scaffold A New UI Bug

```bash
pnpm surgeon scaffold --agentic --id mobile-nav-clipping --bug "Mobile nav clips under the header" --base-url http://localhost:3000 --route /dashboard --visible-selector '[data-test="mobile-nav"]' --expected-failure "primary bug element stays inside viewport" --step "Open dashboard" --step "Tap mobile navigation"
```

The scaffold writes:

- `cases/mobile-nav-clipping.case.json`
- `cases/mobile-nav-clipping.workflow.ts`
- `cases/mobile-nav-clipping.scaffold.md`
- `cases/mobile-nav-clipping.scaffold-analysis.json`

Finish it by editing the workflow script until it reaches the bug state, then replace placeholder selectors in the case verification assertions and confirm `verification.negativeControl.expectedFailures` names the assertion that should fail before the patch.

The current custom-case path supports:

- custom Playwright workflow scripts
- visible assertions
- inside-viewport assertions
- top-within-viewport assertions
- width-at-least assertions
- no-overlap assertions
- no-horizontal-overflow assertions
- no-console-regression assertions

This scaffold is explicitly a draft until it runs and produces a passing scorecard. The `--agentic` path drafts a workflow from the supplied steps, but it still requires selector review and passing before/after verification before the case is trusted.

## Cleanup

```bash
pnpm surgeon target stop
```

Normal demo runs restore the target before-state by default. If a run fails, inspect `run.json`, `doctor.json`, `before-verify.json`, `verify.json`, and the target logs under `SURGEON_TARGET_LOG_DIR`.
