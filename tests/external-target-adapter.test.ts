import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { type CaseFile } from "../packages/schemas/src/index.ts";
import { createTargetAdapter } from "../packages/engine/src/targets/factory.ts";
import { resolveExecutable } from "../packages/engine/src/targets/command.ts";

test("target factory keeps verified CRWA cases on the CRWA adapter", () => {
  const adapter = createTargetAdapter(buildCase({ repo: "cypress-realworld-app" }));

  assert.equal(adapter.id, "cypress-realworld-app");
});

test("target factory uses an external adapter for non-CRWA cases", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "surgeon-external-target-"));
  const adapter = createTargetAdapter(buildCase({ repo: repoPath, baseUrl: "http://127.0.0.1:4321" }));

  assert.equal(adapter.id, "external");
  assert.equal(adapter.repoPath, resolve(repoPath));
  assert.match(await adapter.start(), /already-running external target/i);
  assert.match(await adapter.stop(), /no managed external target/i);
});

test("external adapter can apply and reverse a patch in a local target repo", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "surgeon-patch-target-"));
  const filePath = join(repoPath, "message.txt");
  const patchPath = join(repoPath, "message.patch");
  const adapter = createTargetAdapter(buildCase({ repo: repoPath }));

  await writeFile(filePath, "old\n", "utf8");
  await writeFile(
    patchPath,
    [
      "diff --git a/message.txt b/message.txt",
      "--- a/message.txt",
      "+++ b/message.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
    "utf8",
  );

  await adapter.setPatchState("patched", patchPath);
  assert.equal((await readFile(filePath, "utf8")).replace(/\r\n/gu, "\n"), "new\n");

  await adapter.setPatchState("clean", patchPath);
  assert.equal((await readFile(filePath, "utf8")).replace(/\r\n/gu, "\n"), "old\n");
});

test("lifecycle command resolution maps package managers to cmd shims on Windows", () => {
  assert.equal(resolveExecutable("pnpm", "win32"), "pnpm.cmd");
  assert.equal(resolveExecutable("npm", "win32"), "npm.cmd");
  assert.equal(resolveExecutable("node", "win32"), "node");
  assert.equal(resolveExecutable("pnpm", "linux"), "pnpm");
});

function buildCase(target: Partial<CaseFile["target"]>): CaseFile {
  return {
    id: "external-target-test",
    title: "External Target Test",
    target: {
      repo: target.repo ?? "external-app",
      stack: target.stack ?? "React",
      baseUrl: target.baseUrl ?? "http://localhost:3000",
      ...target,
    },
    workflow: "custom-script",
    workflowScript: "cases/external-target-test.workflow.ts",
    route: "/",
    viewport: {
      name: "Desktop",
      width: 1280,
      height: 800,
      isMobile: false,
    },
    auth: {
      mode: "none",
    },
    input: {
      screenshotPath: "./inputs/external-target-test.png",
      note: "External target adapter test.",
    },
    repro: {
      steps: ["Open route"],
    },
    artifacts: {
      directory: "./artifacts/external-target-test",
    },
    verification: {
      mustPass: ["Visible state is reached"],
    },
  };
}
