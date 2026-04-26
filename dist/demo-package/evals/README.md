# Evaluations

This folder defines how Forensic Repo Surgeon is judged beyond a single demo.

Run:

```bash
pnpm eval:proof
```

The command reads `evals/proof-benchmark.json`, inspects generated case artifacts, and writes:

- `artifacts/evals/proof-evaluation.json`
- `artifacts/evals/proof-evaluation.md`

The evaluation deliberately separates two bars:

- Controlled demo: enough evidence to show the workflow works on known cases.
- Production confidence: enough diversity and negative controls to argue the tool is broadly reliable for UI-heavy teams.

Current expected state: controlled demo can pass; production confidence should not pass until we add more cases, at least one more target repo, and before-state negative controls.
