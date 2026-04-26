# Forensic Repo Surgeon

> **Models propose. Verifiers decide.**
>
> Forensic Repo Surgeon is a portable proof contract for AI-authored frontend repairs. Bring your own agent. Our deterministic verifier decides if the bug actually got fixed.

Built for the [Built with Opus 4.7: a Claude Code hackathon](https://cerebralvalley.ai/events/~/e/built-with-4-7-hackathon).

**Live cockpit:** [forensic-cockpit.vercel.app](https://forensic-cockpit.vercel.app) — fixture-vs-model side-by-side, full agent transcript, all artifacts browsable. No install required.

## What This Is, Honestly

Most AI coding tools generate a diff and a confident PR description. None of them produce **portable, machine-readable proof** that the bug actually got reproduced and fixed.

Forensic Repo Surgeon ships:

1. A **case contract** — schema describing the bug, target, viewport, repro steps, assertions, and negative control.
2. A **deterministic verifier** — Playwright-driven before/after browser evidence + JSON-configured assertions.
3. A **proof boundary** — `before-verify.json`, `verify.json`, `doctor.json`, `run.json`, `scorecard.json` decide acceptance. Models cannot bypass them.
4. A **live Claude Code agent loop** — Opus 4.7 authors a candidate patch inside the target repository, using `Read`, `Glob`, `Grep`, and `Edit` tools through `@anthropic-ai/claude-agent-sdk`.
5. A **side-by-side proof** — fixture-authored patch and model-authored patch are evaluated by the same verifier. The cockpit shows both scorecards, both diffs, the full agent transcript.

## The Hackathon Hero Result

On the date-range drawer case, Opus 4.7 (via the Claude Code agent loop) read **one file**, made **one Edit** changing `anchor="bottom"` to `anchor="top"`, and produced a 13-line diff that **passed the same deterministic verifier as the human-authored fixture** (status: passing, score: 100/100).

On the onboarding case, Opus authored a layout fix that the verifier honestly caught — 8/10 assertions passed (score: 92/100, status: failing). The model fixed the layout overflow but did not widen mobile touch targets. The proof boundary did its job.

> Two cases. Two completely different model patches. Two honest verifier outcomes. One schema. One verifier. The model did real work; the verifier decided what counted.

## How It Works

```text
case contract
  -> target adapter
  -> browser reproduction
  -> before-state negative control
  -> evidence bundle
  -> source localization
  -> bounded reasoner (single-call diagnosis)
  -> fixture patch -> deterministic verification -> scorecard
  -> Claude Code agent loop (Opus 4.7) -> model patch -> deterministic verification -> model-scorecard
  -> portable static proof package
```

The acceptance rule is strict and identical for fixture and model:

> Models can explain, propose, and edit. `before-verify.json`, `verify.json`, `doctor.json`, `run.json`, `scorecard.json`, and `model-scorecard.json` decide acceptance.

## Quick Start

```bash
pnpm install
pnpm verify:source
```

Run the full proof package without an API key (fixture pipeline only):

```bash
pnpm demo
```

Run the full proof package with the live Claude Code agent loop (requires `ANTHROPIC_API_KEY`):

```bash
# copy .env.example to .env.local and set ANTHROPIC_API_KEY
pnpm demo:live-opus
```

Open the static proof package:

```text
dist/demo-package/artifacts/index.html
```

You can also run the agent loop standalone for an already-prepared case:

```bash
pnpm surgeon model-patch --case cases/cypress-realworld-mobile-date-range-drawer.case.json --max-turns 12
```

## What's In The Proof Package

For each verified case the cockpit ships:

- `failure.png` and `success.png` — before / after screenshots
- `before-verify.json` — deterministic negative control proving the bug actually fails before the patch
- `verify.json` — deterministic verification proving the fixture patch fixes it
- `scorecard.json` — fixture proof scorecard
- `reasoner.json` / `reasoner.md` — single-call diagnosis (separate from the agent loop)
- `model-agent-trace.json` / `model-agent-trace.md` — full Claude Code agent transcript: turns, tool calls, files read, files edited, tokens, cost
- `model-patch.diff` — the diff Opus 4.7 actually authored inside the target repo
- `model-verify.json` — same verifier, applied to the model patch
- `model-scorecard.json` — model proof scorecard, scored against the same gates as the fixture
- `model-patch.png` — after-screenshot when the model patch is applied
- `evidence-manifest.json` — SHA-256 hashes for every artifact
- `redaction-report.json` — what was redacted from logs/snapshots before sharing
- `run.json` — full pipeline timeline
- `doctor.json` — recorded environment of the producer machine
- `PR.md` and `github-check.md` — PR/check-ready summary

## Differentiation

Cursor, Devin, GitHub Copilot coding agent, and CodeRabbit are broad coding or review systems. **Claude Code with Playwright MCP** can ad-hoc reproduce most of what a single CLI agent does in a session. None of those produce a **portable, machine-readable proof contract** that any agent or CI can attach, verify, and inspect.

The defensible position is the **schema and the verifier**, not another agent:

> Bring your own agent. Our verifier decides if the bug actually got fixed.

That framing makes Cursor, Devin, Copilot, and Claude Code consumers of the proof contract instead of competitors to a CLI.

## Use It On Your Own App

Start with a scaffold. With `ANTHROPIC_API_KEY` set, the `--agentic` flag uses the Claude Code agent SDK to draft the Playwright workflow:

```bash
pnpm surgeon scaffold --agentic --id mobile-nav-clipping \
  --bug "Mobile nav clips under the header" \
  --base-url http://localhost:3000 --route /dashboard \
  --visible-selector '[data-test="mobile-nav"]' \
  --expected-failure "primary bug element stays inside viewport" \
  --step "Open dashboard" --step "Tap mobile navigation"
```

This creates:

- `cases/<id>.case.json`
- `cases/<id>.workflow.ts` — Playwright draft (model-authored if API key present, regex-heuristic if not)
- `cases/<id>.scaffold.md`
- `cases/<id>.scaffold-analysis.json` (with `--agentic`)
- `cases/<id>.scaffold-trace.json` when the live model path produced the draft

The case can use a custom workflow plus JSON-configured assertions, so most new UI cases no longer require engine edits. Without an API key, the scaffold falls back to a conservative regex draft and is honestly labeled as such.

## Public Docs

- [Quickstart](./docs/quickstart.md) - install, run, export, configure local env.
- [Architecture](./docs/architecture.md) - proof boundary, modules, scaling model.
- [Positioning](./docs/positioning.md) - how this differs from Cursor, Devin, Copilot, CodeRabbit, and Claude Code with Playwright MCP.
- [Roadmap](./docs/roadmap.md) - what to build next without breaking the narrow proof loop.

## Repository Layout

- `packages/cli` - command-line entrypoint.
- `packages/engine` - evidence, localization, reasoner, agent loop, patch, verification, export.
  - `model-patch.ts` - Claude Code agent loop that authors a candidate diff inside the target repo.
  - `model-scorecard.ts` - parallel verification of the model-authored patch.
  - `agentic-scaffold.ts` - live Claude Code-driven workflow drafter (graceful regex fallback offline).
- `packages/schemas` - case and artifact schemas.
- `cases/` - reproducible case definitions.
- `patches/` - tracked human-authored fixture diffs (golden baseline).
- `evals/` - benchmark contract for visual + deterministic proof.
- `docs/` - the small public documentation set.
- `tests/` - Node-test harness for CLI surface, redaction, scaffolder, model-patch, GitHub summary, and target adapters.

## Honest Confidence

Run `pnpm surgeon eval --manifest evals/proof-benchmark.json` after the demo. Expected current result: **controlled-demo proof passes, production-confidence fails** until there are more cases, more target repos, and more bug classes. We deliberately do not hide this gap.

## License

MIT
