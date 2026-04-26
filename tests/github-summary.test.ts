import test from "node:test";
import assert from "node:assert/strict";

import {
  renderGithubCheckJson,
  renderGithubCheckMarkdown,
  type GithubCheckInput,
} from "../packages/engine/src/github-summary.ts";

const input: GithubCheckInput = {
  caseId: "crwa-mobile-date-range-drawer",
  title: "Date range drawer clipping",
  scorecard: {
    status: "passing",
    score: 100,
    metrics: {
      negativeControlPassed: true,
      verificationPassRate: 1,
      reasonerProvider: "anthropic-messages-api",
    },
    gates: {
      artifactsComplete: true,
      verificationPassing: true,
    },
  },
  beforeVerification: {
    status: "failing",
    negativeControl: {
      status: "passing",
      matchedExpectedFailures: ["calendar container is within the mobile viewport"],
    },
  },
  verification: {
    status: "passing",
    assertions: [
      {
        name: "calendar container is within the mobile viewport",
        pass: true,
      },
    ],
  },
  files: {
    scorecard: "artifacts/case/scorecard.json",
    beforeVerify: "artifacts/case/before-verify.json",
    verify: "artifacts/case/verify.json",
    screenshot: "artifacts/case/failure.png",
    success: "artifacts/case/success.png",
    trace: "artifacts/case/trace.zip",
    redactionReport: "artifacts/case/redaction-report.json",
  },
  residualRisks: ["Adjacent mobile viewport sizes are not exhaustively checked."],
};

test("renders PR/check markdown with proof links and gate status", () => {
  const markdown = renderGithubCheckMarkdown(input);

  assert.match(markdown, /Date range drawer clipping/);
  assert.match(markdown, /passing/);
  assert.match(markdown, /100/);
  assert.match(markdown, /before-state negative control/i);
  assert.match(markdown, /artifacts\/case\/scorecard\.json/);
  assert.match(markdown, /artifacts\/case\/trace\.zip/);
  assert.match(markdown, /Adjacent mobile viewport sizes/);
});

test("renders machine-readable GitHub check payload", () => {
  const payload = renderGithubCheckJson(input);

  assert.equal(payload.caseId, "crwa-mobile-date-range-drawer");
  assert.equal(payload.conclusion, "success");
  assert.equal(payload.summary.score, 100);
  assert.equal(payload.artifacts.redactionReport, "artifacts/case/redaction-report.json");
});
