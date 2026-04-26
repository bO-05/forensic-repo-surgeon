import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { captureVerification } from "./evidence.ts";
import { createTargetAdapter } from "./targets/factory.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

/**
 * Side-by-side proof scorecard for the model-authored patch.
 *
 * The fixture-authored scorecard at `scorecard.json` stays untouched.
 * This module produces `model-scorecard.json`, `model-verify.json`, and
 * `model-patch.png` so the cockpit can show fixture vs model side-by-side.
 *
 * The deterministic verifier is the SAME for both. Only the patch source
 * changes. That is the entire point of the proof boundary: models propose,
 * verifiers decide.
 */

export type ModelScorecard = {
  caseId: string;
  generatedAt: string;
  status: "passing" | "failing" | "skipped";
  score: number;
  source: "claude-agent-sdk";
  comparedTo: "fixture-scorecard";
  metrics: {
    verificationPassRate: number;
    patchTouchesTopCandidate: boolean;
    patchByteLength: number;
    changedFiles: string[];
    durationMs?: number;
  };
  gates: {
    patchProvided: boolean;
    patchApplies: boolean;
    verificationPassing: boolean;
    patchRelevant: boolean;
  };
  artifacts: {
    modelPatch: string;
    modelVerify: string;
    modelScreenshot: string;
    modelTrace: string;
  };
  notes: string[];
};

export type RunModelScorecardOptions = {
  /**
   * Absolute path to the cloned target repo. Defaults to the case adapter cwd.
   */
  targetRepoPath?: string;
  /**
   * Optional fixture patch path used only to compare against. Not applied.
   */
  fixturePatchPath?: string;
};

export async function generateModelScorecard(
  caseFile: CaseFile,
  options: RunModelScorecardOptions = {},
): Promise<ModelScorecard> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const modelPatchPath = resolve(artifactDirectory, "model-patch.diff");
  const modelVerifyPath = resolve(artifactDirectory, "model-verify.json");
  const modelScreenshotPath = resolve(artifactDirectory, "model-patch.png");
  const modelTracePath = resolve(artifactDirectory, "model-agent-trace.json");
  const scorecardPath = resolve(artifactDirectory, "model-scorecard.json");

  await mkdir(artifactDirectory, { recursive: true });

  const startTime = Date.now();

  if (!existsSync(modelPatchPath)) {
    const skipped: ModelScorecard = {
      caseId: caseFile.id,
      generatedAt: new Date().toISOString(),
      status: "skipped",
      score: 0,
      source: "claude-agent-sdk",
      comparedTo: "fixture-scorecard",
      metrics: {
        verificationPassRate: 0,
        patchTouchesTopCandidate: false,
        patchByteLength: 0,
        changedFiles: [],
      },
      gates: {
        patchProvided: false,
        patchApplies: false,
        verificationPassing: false,
        patchRelevant: false,
      },
      artifacts: {
        modelPatch: modelPatchPath,
        modelVerify: modelVerifyPath,
        modelScreenshot: modelScreenshotPath,
        modelTrace: modelTracePath,
      },
      notes: ["No model-authored patch was produced. The agent either was not invoked or did not write file changes."],
    };
    await writeFile(scorecardPath, `${JSON.stringify(skipped, null, 2)}\n`, "utf8");
    return skipped;
  }

  const adapter = createTargetAdapter(caseFile);
  const patchText = await readFile(modelPatchPath, "utf8");
  const patchByteLength = Buffer.byteLength(patchText, "utf8");
  const changedFiles = parseChangedFiles(patchText);

  // Read the fixture localizer top candidate to score patch relevance.
  const candidates = await readJson<{ candidates?: Array<{ relativeFile?: string }> }>(manifest.files.candidates);
  const topCandidate = candidates?.candidates?.[0]?.relativeFile;
  const patchTouchesTopCandidate = Boolean(
    topCandidate && changedFiles.some((file) => normalizePath(file) === normalizePath(topCandidate)),
  );

  let started = false;
  let patchApplied = false;
  let verificationPassing = false;
  let verificationAssertions: Array<{ pass?: boolean; name?: string }> = [];
  let verificationError: string | undefined;

  try {
    await adapter.setPatchState("clean", modelPatchPath);
    await adapter.start();
    started = true;

    // Apply the model patch through the same patch path used by the fixture.
    await adapter.setPatchState("patched", modelPatchPath);
    patchApplied = true;

    // Run verification, but route artifacts to model-* names.
    // captureVerification throws on failure; the verify JSON is still
    // written to disk before the throw, so we always read it back.
    try {
      await captureVerification(caseFile, {
        outputPath: modelVerifyPath,
        screenshotPath: modelScreenshotPath,
      });
    }
    catch (error) {
      verificationError = error instanceof Error ? error.message : String(error);
    }
  }
  catch (error) {
    verificationError = error instanceof Error ? error.message : String(error);
  }
  finally {
    if (patchApplied) {
      try {
        await adapter.setPatchState("clean", modelPatchPath);
      }
      catch {
        // Best-effort cleanup; do not fail the scorecard.
      }
    }
    if (started) {
      try {
        await adapter.stop();
      }
      catch {
        // Best-effort cleanup.
      }
    }
  }

  // Read whatever the verifier persisted to disk. captureVerification
  // always writes verify JSON before throwing, so this is the source of
  // truth for assertion-level results.
  const verifyReport = await readJson<{ status?: string; assertions?: Array<{ pass?: boolean; name?: string }>; error?: string }>(modelVerifyPath);
  if (verifyReport) {
    verificationAssertions = verifyReport.assertions ?? [];
    verificationPassing = verifyReport.status === "passing";
    if (!verificationPassing && !verificationError && verifyReport.error) {
      verificationError = verifyReport.error;
    }
  }
  else if (!verifyReport && verificationError) {
    // Make sure something is on disk if the verifier crashed before writing.
    await writeFile(
      modelVerifyPath,
      `${JSON.stringify(
        {
          caseId: caseFile.id,
          status: "failing",
          checkedAt: new Date().toISOString(),
          screenshot: modelScreenshotPath,
          assertions: [],
          error: verificationError,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const verificationPassRate = ratio(
    verificationAssertions.filter((assertion) => assertion.pass).length,
    verificationAssertions.length,
  );

  const gates = {
    patchProvided: patchByteLength > 0,
    patchApplies: patchApplied,
    verificationPassing,
    patchRelevant: patchTouchesTopCandidate,
  };

  const score = Math.round(
    (gates.patchProvided ? 15 : 0) +
      (gates.patchApplies ? 25 : 0) +
      verificationPassRate * 40 +
      (gates.patchRelevant ? 20 : 0),
  );

  const status: ModelScorecard["status"] = Object.values(gates).every(Boolean) ? "passing" : "failing";

  const notes: string[] = [];
  if (!gates.patchProvided) notes.push("Model produced an empty diff.");
  if (!gates.patchApplies) notes.push("Model patch failed to apply cleanly.");
  if (!gates.verificationPassing) notes.push("Model patch did not pass the deterministic verifier.");
  if (!gates.patchRelevant) notes.push("Model patch did not touch the top localization candidate.");
  if (verificationError) notes.push(`Verifier reported: ${verificationError}`);
  if (notes.length === 0) notes.push("Model-authored patch passed every gate the fixture patch had to pass.");

  const scorecard: ModelScorecard = {
    caseId: caseFile.id,
    generatedAt: new Date().toISOString(),
    status,
    score,
    source: "claude-agent-sdk",
    comparedTo: "fixture-scorecard",
    metrics: {
      verificationPassRate,
      patchTouchesTopCandidate,
      patchByteLength,
      changedFiles,
      durationMs: Date.now() - startTime,
    },
    gates,
    artifacts: {
      modelPatch: modelPatchPath,
      modelVerify: modelVerifyPath,
      modelScreenshot: modelScreenshotPath,
      modelTrace: modelTracePath,
    },
    notes,
  };

  await writeFile(scorecardPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");

  // Best-effort assert artifacts exist on disk.
  await stat(modelVerifyPath).catch(() => undefined);

  return scorecard;
}

function parseChangedFiles(patchText: string): string[] {
  const files = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    const normalizedLine = line.replace(/^\uFEFF/, "");
    const match = normalizedLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match?.[2]) {
      files.add(match[2]);
    }
  }
  return [...files];
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  catch {
    return undefined;
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
