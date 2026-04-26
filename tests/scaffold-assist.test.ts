import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { scaffoldCase } from "../packages/engine/src/scaffold.ts";

test("agentic scaffold writes an executable draft workflow and analysis", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "surgeon-scaffold-assist-"));
  const result = await scaffoldCase({
    id: "mobile-nav-clipping",
    bugText: "Mobile navigation clips under the header",
    baseUrl: "http://localhost:3000",
    route: "/dashboard",
    visibleSelector: '[data-test="mobile-nav"]',
    expectedFailures: ["primary bug element stays inside viewport"],
    steps: ["Open dashboard", "Tap mobile navigation", "Wait for mobile nav"],
    outDir,
    agentic: true,
  } as Parameters<typeof scaffoldCase>[0] & { agentic: boolean });
  const typedResult = result as typeof result & { analysisPath: string };

  const workflow = await readFile(typedResult.workflowPath, "utf8");
  const analysis = JSON.parse(await readFile(typedResult.analysisPath, "utf8")) as {
    confidence: string;
    generatedActions: unknown[];
    requiresHumanReview: boolean;
  };

  assert.doesNotMatch(workflow, /throw new Error/);
  assert.match(workflow, /getByRole\("button"/);
  assert.match(workflow, /mobile navigation/i);
  assert.match(workflow, /\[data-test="mobile-nav"\]/);
  assert.equal(analysis.confidence, "draft");
  assert.equal(analysis.requiresHumanReview, true);
  assert.ok(analysis.generatedActions.length >= 2);
});
