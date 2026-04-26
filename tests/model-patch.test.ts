import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { runModelPatchAgent } from "../packages/engine/src/model-patch.ts";
import { generateModelScorecard } from "../packages/engine/src/model-scorecard.ts";
import { type CaseFile } from "../packages/schemas/src/index.ts";

test("model-patch agent returns a recorded no-api-key trace when ANTHROPIC_API_KEY is missing", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const artifactDir = await mkdtemp(join(tmpdir(), "surgeon-model-patch-"));
    const caseFile = buildCase(artifactDir);
    const result = await runModelPatchAgent(caseFile, {
      targetRepoPath: join(tmpdir(), "this-target-does-not-exist-and-thats-ok"),
    });
    assert.equal(result.trace.status, "no-api-key");
    assert.equal(result.trace.liveModelUsed, false);
    assert.equal(result.trace.totalTurns, 0);
    assert.match(result.trace.recordedRunNote, /ANTHROPIC_API_KEY/);
    const traceJson = JSON.parse(await readFile(result.tracePath, "utf8"));
    assert.equal(traceJson.status, "no-api-key");
    assert.equal(traceJson.provider, "claude-agent-sdk");
  }
  finally {
    if (previousKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }
});

test("model-patch agent records an agent-error trace when the target repo does not exist", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-fake-key-not-a-real-key";

  try {
    const artifactDir = await mkdtemp(join(tmpdir(), "surgeon-model-patch-"));
    const caseFile = buildCase(artifactDir);
    const result = await runModelPatchAgent(caseFile, {
      targetRepoPath: join(tmpdir(), `surgeon-missing-${Date.now()}`),
    });
    assert.equal(result.trace.status, "agent-error");
    assert.equal(result.trace.liveModelUsed, false);
    assert.ok((result.trace.errors ?? []).length > 0);
  }
  finally {
    if (previousKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    }
    else {
      process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }
});

test("model scorecard reports skipped status when no model patch exists", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "surgeon-model-scorecard-"));
  const caseFile = buildCase(artifactDir);
  const scorecard = await generateModelScorecard(caseFile);
  assert.equal(scorecard.status, "skipped");
  assert.equal(scorecard.score, 0);
  assert.equal(scorecard.gates.patchProvided, false);
  assert.equal(scorecard.gates.patchApplies, false);
  const persisted = JSON.parse(await readFile(join(artifactDir, "model-scorecard.json"), "utf8"));
  assert.equal(persisted.status, "skipped");
  assert.equal(persisted.source, "claude-agent-sdk");
});

test("model scorecard parses changed files from a model-authored diff", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "surgeon-model-scorecard-"));
  const caseFile = buildCase(artifactDir);
  // Pretend the agent produced a diff that touches the top candidate.
  await writeFile(
    join(artifactDir, "candidates.json"),
    JSON.stringify({
      candidates: [{ relativeFile: "src/components/SomeComponent.tsx", score: 0.99, reasons: ["test"] }],
    }),
    "utf8",
  );
  await writeFile(
    join(artifactDir, "model-patch.diff"),
    [
      "diff --git a/src/components/SomeComponent.tsx b/src/components/SomeComponent.tsx",
      "--- a/src/components/SomeComponent.tsx",
      "+++ b/src/components/SomeComponent.tsx",
      "@@ -1,3 +1,3 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
    "utf8",
  );

  // The verifier path will fail because there's no real target running.
  // We only assert the static metrics that don't require a browser.
  const scorecard = await generateModelScorecard(caseFile);
  assert.equal(scorecard.metrics.changedFiles[0], "src/components/SomeComponent.tsx");
  assert.equal(scorecard.metrics.patchTouchesTopCandidate, true);
  assert.equal(scorecard.gates.patchProvided, true);
  assert.equal(scorecard.gates.patchRelevant, true);
  // verificationPassing will be false because no real target runs in this test.
});

function buildCase(artifactDirectory: string): CaseFile {
  return {
    id: "model-patch-test-case",
    title: "Model patch test case",
    target: {
      // Non-CRWA repo so the external adapter is selected. Using a missing
      // path keeps lifecycle work as a guaranteed no-op for these tests.
      repo: join(tmpdir(), `surgeon-missing-target-${Date.now()}`),
      stack: "React",
      baseUrl: "http://127.0.0.1:9999",
    },
    workflow: "custom-script",
    workflowScript: "cases/model-patch-test-case.workflow.ts",
    route: "/",
    viewport: {
      name: "iPhone 13",
      width: 390,
      height: 844,
      isMobile: true,
    },
    auth: {
      mode: "none",
    },
    input: {
      screenshotPath: "./inputs/model-patch-test-case.png",
      note: "Model patch tests use a synthetic non-CRWA target.",
    },
    repro: {
      steps: ["Open route"],
    },
    artifacts: {
      directory: artifactDirectory,
    },
    verification: {
      mustPass: ["Verifier evaluates whatever patch is applied"],
      assertions: [
        {
          type: "visible",
          name: "primary element is visible",
          selector: "[data-test=\"primary\"]",
        },
      ],
    },
  };
}
