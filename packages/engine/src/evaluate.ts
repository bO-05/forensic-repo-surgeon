import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type ZodType } from "zod";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { loadCaseFile } from "./intake.ts";
import {
  EvaluationManifestSchema,
  ProofScorecardSchema,
  VerificationResultSchema,
  type EvaluationAcceptanceBar,
  type EvaluationCase,
  type ProofScorecard,
  type VerificationResult,
} from "../../schemas/src/index.ts";

type CaseEvaluation = {
  id: string;
  title: string;
  target: string;
  bugClass: string;
  artifactProofPassing: boolean;
  benchmarkReady: boolean;
  score: number;
  assertionCount: number;
  assertionFamilies: string[];
  missingArtifacts: string[];
  missingRequiredAssertions: string[];
  gates: {
    requiredArtifactsPresent: boolean;
    scorecardPassing: boolean;
    deterministicAfterAssertionsPassing: boolean;
    minimumAssertionsMet: boolean;
    requiredAssertionsCovered: boolean;
    patchTouchesTopCandidate: boolean;
    reasonerDisclosurePresent: boolean;
    negativeControlPresent: boolean;
    negativeControlPassed: boolean;
  };
  notes: string[];
};

type EvaluationReport = {
  id: string;
  version: string;
  generatedAt: string;
  mission: string;
  status: "production-confidence-passing" | "needs-more-evidence" | "insufficient";
  summary: {
    casesEvaluated: number;
    artifactProofCases: number;
    benchmarkReadyCases: number;
    targetCount: number;
    bugClassCount: number;
    assertionCount: number;
    assertionFamilies: string[];
  };
  acceptanceBars: Array<EvaluationAcceptanceBar & {
    passing: boolean;
    actual: {
      artifactProofCases: number;
      targetCount: number;
      bugClassCount: number;
      negativeControlsComplete: boolean;
    };
    missing: string[];
  }>;
  cases: CaseEvaluation[];
  knownGaps: string[];
  verdict: string;
};

export async function generateProofEvaluation(options: {
  manifestPath?: string;
  outDir?: string;
} = {}): Promise<string> {
  const manifestPath = resolve(options.manifestPath ?? "evals/proof-benchmark.json");
  const outDir = resolve(options.outDir ?? "artifacts/evals");
  const manifest = EvaluationManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const cases = await Promise.all(
    manifest.cases.map(async (evaluationCase) => evaluateCase(evaluationCase, manifest.requiredArtifacts)),
  );
  const artifactProofCases = cases.filter((item) => item.artifactProofPassing).length;
  const benchmarkReadyCases = cases.filter((item) => item.benchmarkReady).length;
  const targetCount = new Set(cases.map((item) => item.target)).size;
  const bugClassCount = new Set(cases.map((item) => item.bugClass)).size;
  const assertionFamilies = unique(cases.flatMap((item) => item.assertionFamilies)).sort();
  const assertionCount = cases.reduce((total, item) => total + item.assertionCount, 0);
  const negativeControlsComplete = cases.length > 0 && cases.every((item) => item.gates.negativeControlPassed);
  const acceptanceBars = manifest.acceptanceBars.map((bar) => evaluateAcceptanceBar(bar, {
    artifactProofCases,
    targetCount,
    bugClassCount,
    negativeControlsComplete,
  }));
  const controlledDemoPasses = acceptanceBars.find((bar) => bar.id === "controlled-demo")?.passing ?? false;
  const productionPasses = acceptanceBars.find((bar) => bar.id === "production-confidence")?.passing ?? false;
  const status = productionPasses
    ? "production-confidence-passing"
    : controlledDemoPasses
      ? "needs-more-evidence"
      : "insufficient";
  const report: EvaluationReport = {
    id: manifest.id,
    version: manifest.version,
    generatedAt: new Date().toISOString(),
    mission: manifest.mission,
    status,
    summary: {
      casesEvaluated: cases.length,
      artifactProofCases,
      benchmarkReadyCases,
      targetCount,
      bugClassCount,
      assertionCount,
      assertionFamilies,
    },
    acceptanceBars,
    cases,
    knownGaps: manifest.knownGaps ?? [],
    verdict: buildVerdict(status),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "proof-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdownPath = resolve(outDir, "proof-evaluation.md");
  await writeFile(markdownPath, renderEvaluationMarkdown(report), "utf8");
  return markdownPath;
}

async function evaluateCase(evaluationCase: EvaluationCase, requiredArtifacts: string[]): Promise<CaseEvaluation> {
  const caseFile = await loadCaseFile(evaluationCase.casePath);
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const manifest = createPlannedArtifactManifest(caseFile);
  const scorecardPath = resolve(artifactDirectory, "scorecard.json");
  const verifyPath = resolve(artifactDirectory, "verify.json");
  const scorecard = await readParsedJson(scorecardPath, ProofScorecardSchema);
  const verification = await readParsedJson(verifyPath, VerificationResultSchema);
  const missingArtifacts = await findMissingArtifacts(requiredArtifacts, manifest.files);
  const assertions = verification?.assertions ?? [];
  const missingRequiredAssertions = evaluationCase.requiredAssertions.filter(
    (required) => !assertions.some((assertion) => assertionMatches(assertion, required)),
  );
  const negativeControlPath = evaluationCase.negativeControlArtifact
    ? resolve(artifactDirectory, evaluationCase.negativeControlArtifact)
    : undefined;
  const negativeControlPresent = negativeControlPath ? await existsWithSize(negativeControlPath) : false;
  const negativeControl = negativeControlPath
    ? await readParsedJson(negativeControlPath, VerificationResultSchema)
    : undefined;
  const negativeControlPassed = Boolean(
    negativeControlPresent && negativeControl?.negativeControl?.status === "passing",
  );
  const gates = {
    requiredArtifactsPresent: missingArtifacts.length === 0,
    scorecardPassing: scorecard?.status === "passing",
    deterministicAfterAssertionsPassing:
      verification?.status === "passing" &&
      assertions.length > 0 &&
      assertions.every((assertion) => assertion.pass),
    minimumAssertionsMet: assertions.length >= evaluationCase.minimumAssertions,
    requiredAssertionsCovered: missingRequiredAssertions.length === 0,
    patchTouchesTopCandidate: scorecard?.metrics?.patchTouchesTopCandidate === true,
    reasonerDisclosurePresent: Boolean(scorecard?.metrics?.reasonerProvider),
    negativeControlPresent,
    negativeControlPassed,
  };
  const artifactProofPassing = Object.entries(gates)
    .filter(([key]) => key !== "negativeControlPresent" && key !== "negativeControlPassed")
    .every(([, value]) => value);
  const benchmarkReady = artifactProofPassing && gates.negativeControlPassed;
  const score = Math.round(
    (gates.requiredArtifactsPresent ? 20 : 0) +
      (gates.scorecardPassing ? 15 : 0) +
      (gates.deterministicAfterAssertionsPassing ? 20 : 0) +
      (gates.minimumAssertionsMet ? 10 : 0) +
      (gates.requiredAssertionsCovered ? 10 : 0) +
      (gates.patchTouchesTopCandidate ? 10 : 0) +
      (gates.reasonerDisclosurePresent ? 5 : 0) +
      (gates.negativeControlPassed ? 10 : 0),
  );

  return {
    id: evaluationCase.id,
    title: caseFile.title,
    target: evaluationCase.target,
    bugClass: evaluationCase.bugClass,
    artifactProofPassing,
    benchmarkReady,
    score,
    assertionCount: assertions.length,
    assertionFamilies: unique(assertions.map(classifyAssertion)).sort(),
    missingArtifacts,
    missingRequiredAssertions,
    gates,
    notes: buildCaseNotes(gates),
  };
}

async function findMissingArtifacts(requiredArtifacts: string[], files: Record<string, string>): Promise<string[]> {
  const missing: string[] = [];

  for (const key of requiredArtifacts) {
    const path = files[key];
    if (!path || !(await existsWithSize(path))) {
      missing.push(key);
    }
  }

  return missing;
}

function evaluateAcceptanceBar(
  bar: EvaluationAcceptanceBar,
  actual: {
    artifactProofCases: number;
    targetCount: number;
    bugClassCount: number;
    negativeControlsComplete: boolean;
  },
): EvaluationReport["acceptanceBars"][number] {
  const missing: string[] = [];

  if (actual.artifactProofCases < bar.minimumArtifactProofCases) {
    missing.push(`needs ${bar.minimumArtifactProofCases} artifact-proof cases; has ${actual.artifactProofCases}`);
  }

  if (actual.targetCount < bar.minimumTargets) {
    missing.push(`needs ${bar.minimumTargets} target repos; has ${actual.targetCount}`);
  }

  if (actual.bugClassCount < bar.minimumBugClasses) {
    missing.push(`needs ${bar.minimumBugClasses} bug classes; has ${actual.bugClassCount}`);
  }

  if (bar.requireNegativeControls && !actual.negativeControlsComplete) {
    missing.push("needs passing deterministic before-state negative controls for every case");
  }

  return {
    ...bar,
    passing: missing.length === 0,
    actual,
    missing,
  };
}

function renderEvaluationMarkdown(report: EvaluationReport): string {
  return [
    "# Proof Evaluation",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Mission: ${report.mission}`,
    "",
    `Verdict: **${report.verdict}**`,
    "",
    "## Summary",
    "",
    `- Cases evaluated: ${report.summary.casesEvaluated}`,
    `- Artifact-proof cases: ${report.summary.artifactProofCases}`,
    `- Benchmark-ready cases: ${report.summary.benchmarkReadyCases}`,
    `- Target repos: ${report.summary.targetCount}`,
    `- Bug classes: ${report.summary.bugClassCount}`,
    `- Deterministic assertions: ${report.summary.assertionCount}`,
    `- Assertion families: ${report.summary.assertionFamilies.join(", ") || "none"}`,
    "",
    "## Acceptance Bars",
    "",
    "| Bar | Status | Missing |",
    "| --- | --- | --- |",
    ...report.acceptanceBars.map((bar) => (
      `| ${bar.id} | ${bar.passing ? "passing" : "failing"} | ${bar.missing.join("; ") || "none"} |`
    )),
    "",
    "## Case Results",
    "",
    "| Case | Target | Bug Class | Proof | Benchmark Ready | Score | Assertions | Missing |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- |",
    ...report.cases.map((item) => (
      `| ${item.id} | ${item.target} | ${item.bugClass} | ${item.artifactProofPassing ? "passing" : "failing"} | ${item.benchmarkReady ? "yes" : "no"} | ${item.score} | ${item.assertionCount} | ${[...item.missingArtifacts, ...item.missingRequiredAssertions].join(", ") || "none"} |`
    )),
    "",
    "## Known Gaps",
    "",
    ...report.knownGaps.map((gap) => `- ${gap}`),
    "",
    "## Case Notes",
    "",
    ...report.cases.flatMap((item) => [
      `### ${item.id}`,
      "",
      ...item.notes.map((note) => `- ${note}`),
      "",
    ]),
  ].join("\n");
}

function buildVerdict(status: EvaluationReport["status"]): string {
  if (status === "production-confidence-passing") {
    return "Production-confidence proof passes across the configured benchmark.";
  }

  if (status === "needs-more-evidence") {
    return "Controlled demo proof passes, but production confidence still needs more cases, more targets, and more bug classes.";
  }

  return "Current artifacts are insufficient even for the controlled demo proof bar.";
}

function buildCaseNotes(gates: CaseEvaluation["gates"]): string[] {
  const notes: string[] = [];

  if (!gates.requiredArtifactsPresent) {
    notes.push("Required visual/evidence artifacts are missing.");
  }

  if (!gates.scorecardPassing) {
    notes.push("Scorecard is not passing.");
  }

  if (!gates.deterministicAfterAssertionsPassing) {
    notes.push("After-state deterministic assertions are not passing.");
  }

  if (!gates.minimumAssertionsMet) {
    notes.push("Assertion count is below the benchmark minimum.");
  }

  if (!gates.requiredAssertionsCovered) {
    notes.push("Required assertion coverage is incomplete.");
  }

  if (!gates.patchTouchesTopCandidate) {
    notes.push("Patch does not touch the top localization candidate.");
  }

  if (!gates.reasonerDisclosurePresent) {
    notes.push("Reasoner provider disclosure is missing.");
  }

  if (!gates.negativeControlPresent) {
    notes.push("Missing before-state negative control. The case proves after-state success but not deterministic before-state failure.");
  }

  if (gates.negativeControlPresent && !gates.negativeControlPassed) {
    notes.push("Before-state negative control exists, but it did not record the expected deterministic failure.");
  }

  if (notes.length === 0) {
    notes.push("All case-level evaluation gates passed.");
  }

  return notes;
}

function assertionMatches(
  assertion: { name?: string; expected?: string },
  required: string,
): boolean {
  const haystack = `${assertion.name ?? ""} ${assertion.expected ?? ""}`.toLowerCase();
  return haystack.includes(required.toLowerCase());
}

function classifyAssertion(assertion: { name?: string; expected?: string }): string {
  const text = `${assertion.name ?? ""} ${assertion.expected ?? ""}`.toLowerCase();

  if (text.includes("overflow") || text.includes("scrollwidth")) {
    return "noHorizontalOverflow";
  }

  if (text.includes("visible")) {
    return "visible";
  }

  if (text.includes("top y") || text.includes("near top")) {
    return "topWithin";
  }

  if (text.includes("width >=") || text.includes("touch width")) {
    return "widthAtLeast";
  }

  if (text.includes("viewport") || text.includes("x/y bounds")) {
    return "insideViewport";
  }

  if (text.includes("overlap")) {
    return "noOverlap";
  }

  if (text.includes("console")) {
    return "noConsoleRegression";
  }

  return "other";
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  catch {
    return undefined;
  }
}

async function readParsedJson<T>(path: string, schema: ZodType<T>): Promise<T | undefined> {
  const raw = await readJson<unknown>(path);
  const result = schema.safeParse(raw);
  return result.success ? result.data : undefined;
}

async function existsWithSize(path: string): Promise<boolean> {
  try {
    return (await stat(resolve(path))).size > 0;
  }
  catch {
    return false;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
