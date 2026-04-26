#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  captureEvidence,
  captureVerification,
  createPlannedArtifactManifest,
  exportDemoPackage,
  generateArtifactViewer,
  generateDemoHub,
  generateGithubCheckSummary,
  generateHypothesisArtifact,
  generateLocalizationCandidates,
  generateModelScorecard,
  generateProofEvaluation,
  generateProofScorecard,
  generateReasonerArtifacts,
  postGithubCheckRun,
  runDemo,
  loadCaseFile,
  markCasePlanned,
  renderPrReport,
  runDoctor,
  runCase,
  runModelPatchAgent,
  scaffoldCase,
  summarizeCaseFile,
  setupCrwaTarget,
  startCrwaTarget,
  stopCrwaTarget,
} from "../../engine/src/index.ts";
import { configureDemoReasoner } from "./reasoner-flags.ts";

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArgs(flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }

  return values;
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  surgeon doctor --case <path>",
      "  surgeon run --case <path> [--keep-target-running] [--restore-original] [--skip-typecheck]",
      "  surgeon intake --case <path>",
      "  surgeon evidence --case <path>",
      "  surgeon verify --case <path>",
      "  surgeon localize --case <path> [--repo <path>] [--out <path>]",
      "  surgeon reasoner --case <path>",
      "  surgeon hypothesis --case <path>",
      "  surgeon scorecard --case <path>",
      "  surgeon viewer --case <path>",
      "  surgeon hub --case <path> [--out <path>]",
      "  surgeon github-summary --case <path>",
      "  surgeon export --case <path> [--out <directory>]",
      "  surgeon eval --manifest <path> [--out <directory>]",
      "  surgeon demo [--live-opus] [--model-patch] [--no-model-patch]",
      "  surgeon model-patch --case <path> [--target-repo <path>] [--max-turns <n>]",
      "  surgeon github-check-post --case <path> [--dry-run]",
      "  surgeon target setup|start|stop",
      "  surgeon scaffold --id <id> [--agentic] [--bug <text>] [--screenshot <path>] [--title <title>] [--base-url <url>] [--route <route>] [--visible-selector <selector>] [--expected-failure <name>...] [--step <text>...]",
      "  surgeon report --case <path> --out <path>",
      "  surgeon planned --case <path>",
      "  surgeon manifest --case <path> --out <path>",
    ].join("\n"),
  );
}

async function run(): Promise<void> {
  await loadLocalEnv();

  const command = process.argv[2];

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const casePath = getArg("--case");

  if (command === "demo") {
    const liveOpus = hasFlag("--live-opus");
    configureDemoReasoner(liveOpus);
    // Default behavior: when --live-opus is set, also run the model-authored
    // patch pass alongside the fixture pipeline. --no-model-patch opts out.
    // --model-patch alone (without --live-opus) requires an API key and forces it on.
    const modelPatchExplicit = hasFlag("--model-patch");
    const modelPatchOptOut = hasFlag("--no-model-patch");
    const modelPatch = modelPatchExplicit
      ? true
      : modelPatchOptOut
        ? false
        : liveOpus;
    if (modelPatch && !process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is required for --model-patch. Copy .env.example to .env.local and set the key locally, or pass --no-model-patch.",
      );
    }
    const result = await runDemo({ modelPatch });
    console.log("Completed demo proof run.");
    for (const demoCase of result.cases) {
      console.log(`- ${demoCase.id}: ${demoCase.artifactDirectory}`);
      console.log(`  scorecard: ${demoCase.scorecardPath}`);
      if (demoCase.modelScorecard) {
        console.log(
          `  model-scorecard: status=${demoCase.modelScorecard.status} score=${demoCase.modelScorecard.score} (claude-agent-sdk)`,
        );
      }
      if (demoCase.modelTrace) {
        console.log(
          `  model-agent-trace: turns=${demoCase.modelTrace.totalTurns} tools=${demoCase.modelTrace.totalToolCalls} status=${demoCase.modelTrace.status}`,
        );
      }
    }
    console.log(`Evaluation: ${result.evaluationPath}`);
    console.log(`Cockpit: ${result.cockpitPath}`);
    console.log(`Static proof package: ${result.exportPath}`);
    console.log(`Open: ${result.exportPath}/artifacts/index.html`);
    return;
  }

  if (command === "model-patch") {
    if (!casePath) {
      throw new Error("Missing required --case argument.");
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is required for surgeon model-patch. Copy .env.example to .env.local and set the key locally.",
      );
    }
    const caseFile = await loadCaseFile(casePath);
    const targetRepoPath =
      getArg("--target-repo") ??
      // Default: assume the case is for cypress-realworld-app under the standard target root.
      resolve(".surgeon-targets", caseFile.target.repo);
    const maxTurnsValue = getArg("--max-turns");
    const maxTurns = maxTurnsValue ? Number.parseInt(maxTurnsValue, 10) : undefined;
    const agentResult = await runModelPatchAgent(caseFile, {
      targetRepoPath,
      maxTurns: Number.isFinite(maxTurns) && maxTurns! > 0 ? maxTurns : undefined,
    });
    console.log(`Model agent trace: ${agentResult.tracePath}`);
    if (agentResult.patchPath) {
      console.log(`Model patch: ${agentResult.patchPath}`);
    }
    const scorecard = await generateModelScorecard(caseFile);
    console.log(
      `Model scorecard: status=${scorecard.status} score=${scorecard.score} verificationPass=${scorecard.metrics.verificationPassRate}`,
    );
    return;
  }

  if (command === "target") {
    const targetCommand = process.argv[3];

    if (targetCommand === "setup") {
      console.log(await setupCrwaTarget());
      return;
    }

    if (targetCommand === "start") {
      console.log(await startCrwaTarget());
      return;
    }

    if (targetCommand === "stop") {
      console.log(await stopCrwaTarget());
      return;
    }

    throw new Error("Usage: surgeon target setup|start|stop");
  }

  if (command === "eval") {
    const outPath = await generateProofEvaluation({
      manifestPath: getArg("--manifest"),
      outDir: getArg("--out"),
    });
    console.log(`Wrote proof evaluation to ${outPath}`);
    return;
  }

  if (command === "scaffold") {
    const id = getArg("--id");

    if (!id) {
      throw new Error("Missing required --id argument.");
    }

    const result = await scaffoldCase({
      id,
      title: getArg("--title"),
      targetRepo: getArg("--target-repo"),
      stack: getArg("--stack"),
      bugText: getArg("--bug") ?? getArg("--bug-text"),
      screenshotPath: getArg("--screenshot"),
      baseUrl: getArg("--base-url"),
      route: getArg("--route"),
      viewport: getArg("--viewport") === "desktop" ? "desktop" : "mobile",
      authMode: parseAuthMode(getArg("--auth")),
      username: getArg("--username"),
      password: getArg("--password"),
      visibleSelector: getArg("--visible-selector"),
      outDir: getArg("--out"),
      steps: getArgs("--step"),
      expectedFailures: getArgs("--expected-failure"),
      agentic: hasFlag("--agentic"),
    });
    console.log(`Wrote case scaffold to ${result.casePath}`);
    console.log(`Wrote workflow scaffold to ${result.workflowPath}`);
    console.log(`Wrote scaffold guide to ${result.guidePath}`);
    if (result.analysisPath) {
      console.log(`Wrote scaffold analysis to ${result.analysisPath}`);
    }
    return;
  }

  if (!casePath) {
    throw new Error("Missing required --case argument.");
  }

  const caseFile = await loadCaseFile(casePath);

  if (command === "run") {
    const artifactDirectory = await runCase(caseFile, {
      keepTargetRunning: hasFlag("--keep-target-running"),
      restoreOriginal: hasFlag("--restore-original") ? true : undefined,
      skipTypecheck: hasFlag("--skip-typecheck"),
    });
    console.log(`Completed run for ${caseFile.id} in ${artifactDirectory}`);
    return;
  }

  if (command === "doctor") {
    const outPath = await runDoctor(caseFile);
    console.log(`Wrote doctor report to ${outPath}`);
    return;
  }

  if (command === "intake") {
    console.log(summarizeCaseFile(caseFile));
    return;
  }

  if (command === "report") {
    const outPath = getArg("--out");

    if (!outPath) {
      throw new Error("Missing required --out argument.");
    }

    const resolvedOutPath = resolve(outPath);
    await mkdir(dirname(resolvedOutPath), { recursive: true });
    const candidatesPath = resolve(caseFile.artifacts.directory, "candidates.json");
    const beforeVerifyPath = resolve(caseFile.artifacts.directory, caseFile.verification.negativeControl?.artifact ?? "before-verify.json");
    const verifyPath = resolve(caseFile.artifacts.directory, "verify.json");
    const reasonerPath = resolve(caseFile.artifacts.directory, "reasoner.json");
    const candidateReport = await readOptionalJson(candidatesPath);
    const beforeVerificationReport = await readOptionalJson(beforeVerifyPath);
    const verificationReport = await readOptionalJson(verifyPath);
    const reasonerArtifact = await readOptionalJson(reasonerPath);
    await writeFile(
      resolvedOutPath,
      renderPrReport(caseFile, candidateReport, verificationReport, reasonerArtifact, beforeVerificationReport),
      "utf8",
    );
    console.log(`Wrote report to ${resolvedOutPath}`);
    return;
  }

  if (command === "planned") {
    const outPath = await markCasePlanned(caseFile);
    console.log(`Wrote planned-case marker to ${outPath}`);
    return;
  }

  if (command === "evidence") {
    const artifactDirectory = await captureEvidence(caseFile);
    console.log(`Captured evidence to ${artifactDirectory}`);
    return;
  }

  if (command === "verify") {
    const artifactDirectory = await captureVerification(caseFile);
    console.log(`Captured verification to ${artifactDirectory}`);
    return;
  }

  if (command === "localize") {
    const outPath = await generateLocalizationCandidates(caseFile, {
      repoPath: getArg("--repo"),
      outPath: getArg("--out"),
    });
    console.log(`Wrote localization candidates to ${outPath}`);
    return;
  }

  if (command === "hypothesis") {
    const outPath = await generateHypothesisArtifact(caseFile);
    console.log(`Wrote repair hypothesis to ${outPath}`);
    return;
  }

  if (command === "reasoner") {
    const outPath = await generateReasonerArtifacts(caseFile);
    console.log(`Wrote reasoner artifacts to ${outPath}`);
    return;
  }

  if (command === "scorecard") {
    const outPath = await generateProofScorecard(caseFile);
    console.log(`Wrote proof scorecard to ${outPath}`);
    return;
  }

  if (command === "viewer") {
    const outPath = await generateArtifactViewer(caseFile);
    console.log(`Wrote artifact viewer to ${outPath}`);
    return;
  }

  if (command === "hub") {
    const outPath = await generateDemoHub(caseFile, getArg("--out"));
    console.log(`Wrote demo cockpit to ${outPath}`);
    return;
  }

  if (command === "github-summary") {
    const outPath = await generateGithubCheckSummary(caseFile);
    console.log(`Wrote GitHub proof summary to ${outPath}`);
    return;
  }

  if (command === "github-check-post") {
    const dryRun = hasFlag("--dry-run");
    const result = await postGithubCheckRun(caseFile, { dryRun });
    if (result.status === "posted") {
      console.log(`Posted GitHub Check Run for ${result.caseId} (${result.conclusion})`);
      if (result.htmlUrl) console.log(`Check Run: ${result.htmlUrl}`);
      if (result.commentHtmlUrl) console.log(`PR comment: ${result.commentHtmlUrl}`);
    }
    else if (result.status === "skipped") {
      console.log(`Skipped GitHub Check Run for ${result.caseId}: ${result.reason ?? "unknown"}`);
    }
    else {
      console.error(`Failed to post GitHub Check Run for ${result.caseId}: ${result.reason ?? "unknown"}`);
      process.exitCode = 1;
    }
    return;
  }

  if (command === "export") {
    const outPath = await exportDemoPackage(caseFile, getArg("--out"));
    console.log(`Exported static demo package to ${outPath}`);
    return;
  }

  if (command === "manifest") {
    const outPath = getArg("--out");

    if (!outPath) {
      throw new Error("Missing required --out argument.");
    }

    const resolvedOutPath = resolve(outPath);
    await mkdir(dirname(resolvedOutPath), { recursive: true });
    await writeFile(
      resolvedOutPath,
      `${JSON.stringify(createPlannedArtifactManifest(caseFile), null, 2)}\n`,
      "utf8",
    );
    console.log(`Wrote manifest to ${resolvedOutPath}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  }
  catch {
    return undefined;
  }
}

async function loadLocalEnv(path = resolve(".env.local")): Promise<void> {
  let contents: string;

  try {
    contents = await readFile(path, "utf8");
  }
  catch {
    return;
  }

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex < 1) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

function parseAuthMode(value: string | undefined): "none" | "ui" | "storageState" | undefined {
  if (value === "none" || value === "ui" || value === "storageState") {
    return value;
  }

  return undefined;
}
