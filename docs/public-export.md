# Privacy-sanitized recorded exports

The operational `artifacts/` directory retains the original recorded evidence. Do not sanitize or overwrite those originals to make a public demo.

Export the existing recording without running the target, verifier, or model:

```bash
pnpm surgeon export --case cases/cypress-realworld-mobile-date-range-drawer.case.json --out dist/reviewed-public-copy
```

Choose a new output directory. The exporter replaces the selected output, so do not point it at private work or an existing stage.

The public copy replaces producer workspace, home, target-repository, and tool paths with placeholders. It sanitizes JSON, NDJSON, prose, HTML, and text inside browser trace ZIPs. Ordinary browser URLs, relative source filenames, and recorded numeric/boolean verification outcomes are retained. Dossiers are rebuilt from sanitized inputs, then case and package SHA-256 maps are refreshed.

Every exported HTML page carries a recorded-evidence notice. Export timestamps and hashes describe this public copy, not a new model or verifier run. Screenshots remain recorded binary evidence. This is not a claim of universal anonymization, signed provenance, or removal of copies someone already downloaded.

## Safe staging and deployment

Review the public copy before promoting it to `dist/demo-package`. Run `pnpm typecheck` and `pnpm test`.

```bash
pnpm stage:cockpit
```

Staging checks the complete artifact inventory and hashes against the export integrity map. It creates a fresh ignored directory and copies only the existing Vercel project linkage, if present. It does not delete an old stage, remove its `.vercel` directory, create a project, or deploy anything.

Production requires a separately confirmed existing project and organization:

```bash
pnpm deploy:cockpit --project-id <confirmed-project-id> --org-id <confirmed-organization-id>
```

Both IDs must match the preserved project linkage. The deploy command refuses a missing or mismatched target. Check the resulting production alias, dossier, JSON, and trace archives before restoring a live demo link. Previously deployed copies and caches need separate account-authorized review; a local export does not remove them.
