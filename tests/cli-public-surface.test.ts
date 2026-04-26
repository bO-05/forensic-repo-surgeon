import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { configureDemoReasoner } from "../packages/cli/src/reasoner-flags.ts";

const publicDocs = [
  "README.md",
  "docs/quickstart.md",
  "docs/architecture.md",
  "docs/roadmap.md",
  "CONTRIBUTING.md",
] as const;

test("package exposes a small product script surface", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  // Allowlist enforced to prevent regression to the 41-script "hackathon
  // drawer" surface called out in feedback v2/v3. Each new script must be
  // user-facing, single-purpose, and worth surfacing on the public CLI.
  // - demo / demo:live-opus     — primary "run the proof pipeline" entrypoints
  // - surgeon                   — the underlying CLI for advanced sub-commands
  // - test / typecheck          — engineering basics
  // - verify:source             — the hackathon-grade smoke check
  assert.deepEqual(Object.keys(pkg.scripts).sort(), [
    "demo",
    "demo:live-opus",
    "surgeon",
    "test",
    "typecheck",
    "verify:source",
  ].sort());
});

test("live Opus demo uses the cross-platform TypeScript CLI", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.equal(pkg.scripts["demo:live-opus"], "tsx packages/cli/src/index.ts demo --live-opus");
  assert.doesNotMatch(pkg.scripts["demo:live-opus"], /powershell|\.ps1/i);
});

test("live Opus flag forces the Anthropic provider even when env requested fallback", () => {
  const env = {
    ANTHROPIC_API_KEY: "test-key",
    SURGEON_REASONER_PROVIDER: "deterministic",
  } as NodeJS.ProcessEnv;

  configureDemoReasoner(true, env);

  assert.equal(env.SURGEON_REASONER_PROVIDER, "anthropic");
  assert.equal(env.SURGEON_REASONER_MODEL, "claude-opus-4-7");
});

test("public docs no longer present the main lifecycle as PowerShell-only", () => {
  for (const docPath of publicDocs) {
    const contents = readFileSync(docPath, "utf8");

    assert.doesNotMatch(contents, /Target lifecycle scripts are currently Windows PowerShell based/i, docPath);
    assert.doesNotMatch(contents, /For full browser demos on Windows/i, docPath);
    assert.doesNotMatch(contents, /```powershell/i, docPath);
    assert.doesNotMatch(contents, /pnpm case:scaffold/i, docPath);
    assert.doesNotMatch(contents, /pnpm target:/i, docPath);
    assert.doesNotMatch(contents, /pnpm (demo:drawer|demo:onboarding|export:demo|eval:proof|doctor:|evidence:|verify:(?!source)|localize:|reasoner:|scorecard:|viewer:|hub:|report:)/i, docPath);
  }
});

test("runtime messages do not mention removed public script aliases", () => {
  const sourceFiles = [
    "packages/engine/src/export-package.ts",
    "packages/engine/src/localize.ts",
    "packages/engine/src/targets/crwa.ts",
    "packages/engine/src/targets/crwa-lifecycle.ts",
  ];

  for (const sourceFile of sourceFiles) {
    const contents = readFileSync(sourceFile, "utf8");

    assert.doesNotMatch(contents, /pnpm (target:setup|target:stop|eval:proof)/i, sourceFile);
  }
});
