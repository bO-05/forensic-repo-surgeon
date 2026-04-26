import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { postGithubCheckRun } from "../packages/engine/src/github-check-runner.ts";
import { type CaseFile } from "../packages/schemas/src/index.ts";

test("github check runner is a no-op skip when github-check.json is missing", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "surgeon-github-check-"));
  const caseFile = buildCase(artifactDir);
  const result = await postGithubCheckRun(caseFile, { token: "fake", repository: "owner/repo", headSha: "abc" });
  assert.equal(result.status, "skipped");
  assert.match(result.reason ?? "", /github-check\.json is missing/);
});

test("github check runner skips when env vars are missing even with payload present", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "surgeon-github-check-"));
  const caseFile = buildCase(artifactDir);
  await writeFile(
    join(artifactDir, "github-check.json"),
    JSON.stringify({
      caseId: caseFile.id,
      title: caseFile.title,
      conclusion: "success",
      summary: { status: "passing", score: 100, verificationStatus: "passing" },
      failedGates: [],
      artifacts: { scorecard: `${artifactDir}/scorecard.json` },
      residualRisks: [],
    }),
    "utf8",
  );
  const result = await postGithubCheckRun(caseFile, { token: undefined, repository: undefined, headSha: undefined });
  assert.equal(result.status, "skipped");
  assert.match(result.reason ?? "", /GITHUB_TOKEN missing/);
});

test("github check runner returns a dry-run preview without contacting GitHub", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "surgeon-github-check-"));
  const caseFile = buildCase(artifactDir);
  await writeFile(
    join(artifactDir, "github-check.json"),
    JSON.stringify({
      caseId: caseFile.id,
      title: caseFile.title,
      conclusion: "failure",
      summary: { status: "failing", score: 92, verificationStatus: "failing" },
      failedGates: ["verificationPassing"],
      artifacts: { scorecard: `${artifactDir}/scorecard.json` },
      residualRisks: ["Mobile touch widths regressed."],
    }),
    "utf8",
  );
  const result = await postGithubCheckRun(caseFile, {
    token: "should-not-be-used",
    repository: "owner/repo",
    headSha: "deadbeef",
    dryRun: true,
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.conclusion, "failure");
  assert.match(result.reason ?? "", /dryRun/);
});

function buildCase(artifactDirectory: string): CaseFile {
  return {
    id: "github-check-runner-test",
    title: "GitHub Check Runner Test",
    target: {
      repo: "external-test-repo",
      stack: "React",
      baseUrl: "http://127.0.0.1:9999",
    },
    workflow: "custom-script",
    workflowScript: "cases/github-check-runner-test.workflow.ts",
    route: "/",
    viewport: {
      name: "iPhone 13",
      width: 390,
      height: 844,
      isMobile: true,
    },
    auth: { mode: "none" },
    input: {
      screenshotPath: "./inputs/github-check-runner-test.png",
      note: "Synthetic case used by tests.",
    },
    repro: {
      steps: ["Open route"],
    },
    artifacts: {
      directory: artifactDirectory,
    },
    verification: {
      mustPass: ["Visible state is reached"],
    },
  };
}
