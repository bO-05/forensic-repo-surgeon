# Roadmap

The project should stay narrow until the proof loop is strong.

## Phase 1: Productize Current Proof Loop

- Keep `pnpm verify:source` green.
- Keep `pnpm demo` as the one-command browser proof path.
- Keep single-case demo checks available through `pnpm surgeon run --case <case>`.
- Keep static export available through `pnpm surgeon export --case <case>`.
- Keep `pnpm surgeon eval --manifest evals/proof-benchmark.json` honest: controlled-demo can pass, production-confidence should fail until the evidence bar is actually met.
- Keep before-state negative controls passing for verified cases.
- Keep the public docs small: quickstart, architecture, positioning, roadmap.

## Phase 2: Make Cases Easier To Add

- Use `pnpm surgeon scaffold` as the baseline new-bug onboarding path.
- Add an agentic scaffolder that reads a bug ticket, screenshot, or natural-language repro and drafts the custom Playwright workflow.
- Add a workflow registry instead of hardcoded case branches.
- Promote generated scaffold guides into a full case authoring loop.
- Expand the assertion registry for overlap, overflow, interactability, accessibility, console regression, network regression, and visual diff.
- Add source-map and AST/JSX providers behind localization interfaces.

## Phase 3: Make It Useful In Real PRs

- Publish a branch and PR report from a successful run.
- Attach screenshots, traces, `verify.json`, `scorecard.json`, and `reasoner.md` to PRs.
- Convert proof gates into GitHub Check annotations.
- Add hosted proof package publishing.

## Phase 4: Broaden Carefully

- Add a second React target adapter.
- Add Next.js and Vite source-map awareness.
- Add containerized target lifecycle support for teams that prefer Docker over local process management.
- Support captured authenticated sessions.

## Anti-Goals

- Do not claim arbitrary frontend repair yet.
- Do not build a general autonomous coding agent.
- Do not let model text override failed assertions.
- Do not make the repo depend on generated proof artifacts committed to source control.
