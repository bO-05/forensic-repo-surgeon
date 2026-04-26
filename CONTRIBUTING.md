# Contributing

## Local Setup

```bash
pnpm install
pnpm typecheck
```

For full browser demos:

```bash
pnpm surgeon target setup
pnpm surgeon doctor --case cases/cypress-realworld-mobile-date-range-drawer.case.json
pnpm surgeon run --case cases/cypress-realworld-mobile-date-range-drawer.case.json
```

For live Opus 4.7 reasoner runs:

```bash
# copy .env.example to .env.local and set ANTHROPIC_API_KEY
pnpm demo:live-opus
```

## Contribution Rules

- Keep generated artifacts out of normal source commits.
- Keep secrets in `.env.local`; never commit real keys.
- Add new verified cases through `cases/`, `patches/`, reusable assertions, and scorecard gates.
- Do not mark a case verified unless its `verify.json`, `doctor.json`, `run.json`, and `scorecard.json` pass.
