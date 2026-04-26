# Forensic Repo Surgeon Proof Package

Models propose. Verifiers decide. This package contains both: the fixture (human-authored) proof and the model-authored proof, evaluated by the same deterministic verifier.

This folder is the no-setup, static review package. It does not require Claude Code, Node, Playwright, the target app, or the producer machine.

## Headline artifacts

- `artifacts/index.html` - demo cockpit, fixture vs model side-by-side
- `artifacts/crwa-mobile-date-range-drawer/index.html` - detailed validation dossier with Model Authorship card
- `artifacts/crwa-mobile-date-range-drawer/scorecard.json` - fixture proof scorecard
- `artifacts/crwa-mobile-date-range-drawer/model-scorecard.json` - model-authored proof scorecard (claude-opus-4-7 via Claude Code SDK)
- `artifacts/crwa-mobile-date-range-drawer/model-agent-trace.json` - full agent transcript: turns, tool calls, files read/edited, cost, tokens
- `artifacts/crwa-mobile-date-range-drawer/model-agent-trace.md` - human-readable agent transcript
- `artifacts/crwa-mobile-date-range-drawer/model-patch.diff` - the diff Opus 4.7 actually authored inside the target repo

## Supporting artifacts

- `artifacts/crwa-mobile-onboarding-dialog/index.html` - second case dossier (model and fixture)
- `artifacts/crwa-mobile-date-range-drawer/PR.md` - PR-style repair report
- `artifacts/crwa-mobile-date-range-drawer/before-verify.json` - before-state negative control
- `artifacts/crwa-mobile-date-range-drawer/reasoner.md` - bounded reasoner artifact (single-call diagnosis, separate from the agent loop)
- `artifacts/crwa-mobile-date-range-drawer/evidence-manifest.md` - case artifact hash summary
- `artifacts/crwa-mobile-date-range-drawer/redaction-report.json` - artifact redaction summary
- `artifacts/crwa-mobile-date-range-drawer/github-check.md` - PR/check-ready proof summary
- `package-integrity.md` - exported package hash summary
- `artifacts/evals/proof-evaluation.md` - aggregate proof evaluation and current confidence bar
- `evals/proof-benchmark.json` - benchmark contract
- `docs/quickstart.md` - install, rerun, and extension path
- `docs/architecture.md` - proof boundary and scaling model
- `docs/positioning.md` - product differentiation from broad coding and review agents

## Truth boundary

The model agent loop runs through the official `@anthropic-ai/claude-agent-sdk` package using `claude-opus-4-7`. It is given Read, Glob, Grep, and Edit tools inside the target repository. It cannot run shell commands, fetch the web, or write tests. After the agent finishes, `git diff` captures its changes as `model-patch.diff`. The fixture pipeline above already produced a verified scorecard. The model patch is then evaluated against the SAME deterministic gates: artifact completeness, verification pass rate, patch relevance, and absence of console regressions. The verifier is identical for both. That is the proof boundary.

The recorded `doctor.json` describes the producer machine. It does not validate the evaluator's current machine.

## Rerun the live pipeline

```bash
pnpm install
# Set ANTHROPIC_API_KEY in .env.local first.
pnpm demo:live-opus   # fixture + Opus reasoner + Claude Code agent loop
pnpm demo             # fixture + deterministic fallback only
```

Claude / Claude Code is not required to view this package. The recorded model-agent-trace.json shows the actual tool calls, files Opus read and edited, tokens, cost, and final assistant text from the live run.
