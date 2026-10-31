# Forensic Repo Surgeon

> **Models propose. Verifiers decide.**
>
> Forensic Repo Surgeon is a prototype for packaging schema-driven before/after checks for AI-authored frontend repairs. Configured assertions, not model self-reports, determine its recorded acceptance outcome.

Built for the [Built with Opus 4.7: a Claude Code hackathon](https://cerebralvalley.ai/events/~/e/built-with-4-7-hackathon).

**Recorded demo:** [Read-only cockpit](https://forensic-cockpit.vercel.app). It shows saved evidence, not a live analysis service or a new model/verifier run.

**Static proof:** [Recorded proof package](dist/demo-package/README.md), with known producer paths and detected text secrets sanitized and integrity maps refreshed. Binary screenshots are retained; this is not universal anonymization. See the [public export and deployment guide](docs/public-export.md).

## What This Is, Honestly

A diff and a confident PR description are not, by themselves, reproduction or acceptance evidence. This prototype packages that evidence as a portable, machine-readable contract.

Forensic Repo Surgeon ships:

1. A **case contract** — schema describing the bug, target, viewport, repro steps, assertions, and negative control.
2. A **deterministic verifier** — Playwright-driven before/after browser evidence + JSON-configured assertions.
3. A **proof boundary** — saved verifier outputs determine the configured acceptance result, not the model's description.
4. A **provider-dependent Claude Code agent loop** — the CLI can request a candidate patch using `Read`, `Glob`, `Grep`, and `Edit` tools through `@anthropic-ai/claude-agent-sdk`. This is not a public hosted agent service.
5. A **side-by-side proof** — fixture-authored patch and model-authored patch are evaluated by the same verifier. The cockpit shows both scorecards, both diffs, the full agent transcript.

## Recorded Hackathon Results

The following are saved results from the original two cases, not newly repeated benchmarks. SDK and parser security updates do not rerun or change those recorded model/verifier outcomes.

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
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
```

These inspection checks do not regenerate the recorded case evidence. The pipeline commands below create or update run artifacts. Preserve originals and use separate artifact directories before running them. Live model commands require provider credentials and can incur usage charges.

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

Other coding and review systems cover broader workflows. This prototype focuses on a schema-driven evidence package and configured acceptance checks. The two recorded cases do not establish general superiority over other tools or success on arbitrary repositories.

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
