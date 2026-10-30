import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { unzipSync, zipSync } from "fflate";

import { sanitizePublicDirectory, sanitizePublicText } from "../packages/engine/src/public-export.ts";
import { exportDemoPackage } from "../packages/engine/src/export-package.ts";
import type { CaseFile } from "../packages/schemas/src/index.ts";
import { assertDeploymentTarget, cockpitDeploymentEnvironment, stageCockpit } from "../scripts/deploy-cockpit.ts";

test("confirmed deployment IDs override inherited IDs without changing the parent environment", () => {
  const parent = { VERCEL_PROJECT_ID: "prj_other", VERCEL_ORG_ID: "team_other", PATH: "fixture-tools" };
  const child = cockpitDeploymentEnvironment("prj_confirmed", "team_confirmed", parent);
  assert.equal(child.VERCEL_PROJECT_ID, "prj_confirmed");
  assert.equal(child.VERCEL_ORG_ID, "team_confirmed");
  assert.equal(child.PATH, parent.PATH);
  assert.equal(parent.VERCEL_PROJECT_ID, "prj_other");
  assert.equal(parent.VERCEL_ORG_ID, "team_other");
});

test("export refuses overlapping external operational artifacts before deleting anything", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forensic-export-scope-"));
  const operational = join(directory, "operational");
  const marker = join(operational, "original.txt");
  try {
    await mkdir(operational);
    await writeFile(marker, "Retain the operational original.");
    const recorded = JSON.parse(await readFile("cases/cypress-realworld-mobile-date-range-drawer.case.json", "utf8")) as CaseFile;
    const externalCase = { ...recorded, artifacts: { directory: operational } };
    for (const output of [directory, operational, join(operational, "nested")]) {
      await assert.rejects(exportDemoPackage(externalCase, output), /separate from the workspace and operational artifacts/u);
      assert.equal(await readFile(marker, "utf8"), "Retain the operational original.");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("public paths are sanitized without changing browser URLs or verification outcomes", () => {
  const source = {
    repoPath: "D:\\Private Workspace\\target",
    command: "Read D:\\Private Workspace\\target\\src\\App.tsx",
    escaped: 'Read "E:\\Another Private Folder\\file.ts" and continue',
    home: "/home/someone/private-repo/src/main.ts",
    url: "https://example.test/home/someone?tab=details",
    relative: "src/components/Drawer.tsx",
    passed: false,
    passRate: 0.75,
  };
  const result = JSON.parse(sanitizePublicText(JSON.stringify(source)));
  assert.equal(result.command, "Read [local]\\src\\App.tsx");
  assert.equal(result.url, source.url);
  assert.equal(result.relative, source.relative);
  assert.equal(result.passed, false);
  assert.equal(result.passRate, 0.75);
  assert.doesNotMatch(JSON.stringify(result), /Private Workspace|Another Private|someone\/private-repo|[A-Z]:/u);
});

test("public ZIPs sanitize trace text, retain binary resources, and are idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forensic-export-zip-"));
  try {
    const binary = new Uint8Array([0, 255, 128, 1, 9]);
    const trace = '{"type":"before","params":{"file_path":"C:\\\\Private Repo\\\\src\\\\Drawer.tsx"},"passed":true}\n';
    await writeFile(join(directory, "trace.zip"), zipSync({ "trace.trace": new TextEncoder().encode(trace), "resources/image.png": binary }));
    const first = await sanitizePublicDirectory(directory);
    assert.equal(first.changedFiles, 1);
    const after = unzipSync(await readFile(join(directory, "trace.zip")));
    assert.doesNotMatch(new TextDecoder().decode(after["trace.trace"]), /Private Repo|[A-Z]:/u);
    assert.equal(JSON.parse(new TextDecoder().decode(after["trace.trace"])).passed, true);
    assert.deepEqual(after["resources/image.png"], binary);
    assert.equal((await sanitizePublicDirectory(directory)).changedFiles, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function outcomes(value: unknown, prefix = "", output: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(value)) value.forEach((item, index) => outcomes(item, `${prefix}.${index}`, output));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => outcomes(item, `${prefix}.${key}`, output));
  else if (typeof value === "boolean" || typeof value === "number" || (typeof value === "string" && /(?:status|outcome|mode|caseId)$/iu.test(prefix))) output[prefix] = value;
  return output;
}

test("public export refreshes every integrity hash and preserves recorded outcomes and originals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forensic-export-proof-"));
  const caseFile = JSON.parse(await readFile("cases/cypress-realworld-mobile-date-range-drawer.case.json", "utf8")) as CaseFile;
  const originalDoctor = await readFile(resolve(caseFile.artifacts.directory, "doctor.json"));
  const originalTrace = await readFile(resolve(caseFile.artifacts.directory, "trace.zip"));
  try {
    await exportDemoPackage(caseFile, join(directory, "package"));
    const root = join(directory, "package");
    const pkg = JSON.parse(await readFile(join(root, "package-integrity.json"), "utf8"));
    for (const entry of pkg.files) {
      const bytes = await readFile(join(root, entry.path));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path);
      assert.equal(bytes.length, entry.sizeBytes, entry.path);
    }
    for (const id of [caseFile.id, "crwa-mobile-onboarding-dialog"]) {
      const publicDirectory = join(root, "artifacts", id);
      const evidence = JSON.parse(await readFile(join(publicDirectory, "evidence-manifest.json"), "utf8"));
      for (const entry of evidence.files) {
        const bytes = await readFile(join(root, entry.path));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path);
      }
      for (const name of ["scorecard.json", "model-scorecard.json", "verify.json", "model-verify.json", "before-verify.json"]) {
        const original = JSON.parse(await readFile(join("artifacts", id, name), "utf8"));
        const published = JSON.parse(await readFile(join(publicDirectory, name), "utf8"));
        assert.deepEqual(outcomes(published), outcomes(original), `${id}/${name}`);
      }
      assert.match(await readFile(join(publicDirectory, "index.html"), "utf8"), /Privacy-sanitized recorded evidence/u);
    }
    assert.equal((await sanitizePublicDirectory(root)).changedFiles, 0);
    const oldStage = join(directory, "old-stage");
    await mkdir(join(oldStage, ".vercel"), { recursive: true });
    const link = JSON.stringify({ projectId: "prj_test_only", orgId: "team_test_only" });
    await writeFile(join(oldStage, ".vercel/project.json"), link);
    await writeFile(join(oldStage, "private-original.txt"), "Retain this private original.");
    const stage = await stageCockpit({ sourceDir: join(root, "artifacts"), stageParent: join(directory, "stages"), linkPath: join(oldStage, ".vercel/project.json") });
    assert.equal(await readFile(join(oldStage, ".vercel/project.json"), "utf8"), link);
    assert.equal(await readFile(join(oldStage, "private-original.txt"), "utf8"), "Retain this private original.");
    await assertDeploymentTarget(stage, "prj_test_only", "team_test_only");
    await assert.rejects(assertDeploymentTarget(stage, "prj_wrong", "team_test_only"), /does not match/u);
    await assert.rejects(assertDeploymentTarget(stage), /explicit/u);
    await assert.rejects(readFile(join(stage, "private-original.txt")));
    assert.deepEqual(await readFile(resolve(caseFile.artifacts.directory, "doctor.json")), originalDoctor);
    assert.deepEqual(await readFile(resolve(caseFile.artifacts.directory, "trace.zip")), originalTrace);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
