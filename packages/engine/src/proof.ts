import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

type CandidateReport = {
  candidates?: Candidate[];
};

type Candidate = {
  relativeFile?: string;
  score?: number;
  reasons?: string[];
};

type VerificationReport = {
  status?: string;
  assertions?: VerificationAssertion[];
  negativeControl?: {
    status?: string;
    expectedFailures?: string[];
    actualFailures?: string[];
    matchedExpectedFailures?: string[];
    missingExpectedFailures?: string[];
    additionalFailures?: string[];
  };
};

type VerificationAssertion = {
  name?: string;
  pass?: boolean;
};

type RunTimeline = {
  status?: string;
  durationMs?: number;
  options?: {
    keepTargetRunning?: boolean;
    restoreOriginal?: boolean;
  };
  phases?: Array<{
    name?: string;
    status?: string;
  }>;
};

type DoctorReport = {
  status?: string;
};

type ReasonerArtifact = {
  provider?: string;
  evidenceReferences?: string[];
  diagnosis?: {
    symptom?: string;
    likelyRootCause?: string;
    patchHypothesis?: string;
    verificationPlan?: string[];
    residualRisks?: string[];
  };
};

type RedactionReport = {
  status?: string;
};

type ArtifactCheck = {
  key: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
};

type ProofScorecard = {
  caseId: string;
  generatedAt: string;
  status: "passing" | "failing";
  score: number;
  metrics: {
    artifactCompletenessRatio: number;
    verificationPassRate: number;
    patchTouchesTopCandidate: boolean;
    negativeControlPassed: boolean;
    reasonerProvider?: string;
    doctorStatus?: string;
    runStatus?: string;
    cleanupSucceeded: boolean;
    redactionStatus?: string;
    totalRunDurationMs?: number;
    topCandidate?: string;
    changedFiles: string[];
  };
  gates: {
    artifactsComplete: boolean;
    negativeControlPassed: boolean;
    verificationPassing: boolean;
    localizationPresent: boolean;
    patchRelevant: boolean;
    reasonerPresent: boolean;
    reasonerReferencesArtifacts: boolean;
    doctorPassing: boolean;
    runCompleted: boolean;
    cleanupSucceeded: boolean;
    redactionPassed: boolean;
  };
  artifactChecks: ArtifactCheck[];
  notes: string[];
};

const BASE_REQUIRED_ARTIFACT_KEYS = [
  "input",
  "screenshot",
  "trace",
  "console",
  "network",
  "axTree",
  "domSnapshot",
  "candidates",
  "patch",
  "success",
  "verify",
  "hypothesis",
  "reasoner",
  "reasonerReport",
  "redactionReport",
  "doctor",
  "run",
  "report",
  "viewer",
] as const;

export async function generateProofScorecard(caseFile: CaseFile): Promise<string> {
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const manifest = createPlannedArtifactManifest(caseFile);
  const candidates = await readJson<CandidateReport>(manifest.files.candidates);
  const beforeVerification = await readJson<VerificationReport>(manifest.files.beforeVerify);
  const verification = await readJson<VerificationReport>(manifest.files.verify);
  const reasoner = await readJson<ReasonerArtifact>(manifest.files.reasoner);
  const doctor = await readJson<DoctorReport>(manifest.files.doctor);
  const run = await readJson<RunTimeline>(manifest.files.run);
  const redactionReport = await readJson<RedactionReport>(manifest.files.redactionReport);
  const patchText = await readOptionalText(manifest.files.patch);
  const requiredArtifactKeys = caseFile.verification.negativeControl
    ? [...BASE_REQUIRED_ARTIFACT_KEYS, "beforeVerify"] as const
    : BASE_REQUIRED_ARTIFACT_KEYS;
  const artifactChecks = await Promise.all(
    requiredArtifactKeys.map(async (key) => checkArtifact(key, manifest.files[key])),
  );
  const changedFiles = parseChangedFiles(patchText);
  const topCandidate = candidates?.candidates?.[0]?.relativeFile;
  const verificationAssertions = verification?.assertions ?? [];
  const artifactCompletenessRatio = ratio(
    artifactChecks.filter((check) => check.exists && check.sizeBytes > 0).length,
    artifactChecks.length,
  );
  const verificationPassRate = ratio(
    verificationAssertions.filter((assertion) => assertion.pass).length,
    verificationAssertions.length,
  );
  const patchTouchesTopCandidate = Boolean(
    topCandidate && changedFiles.some((file) => normalizePath(file) === normalizePath(topCandidate)),
  );
  const negativeControlPassed = !caseFile.verification.negativeControl ||
    beforeVerification?.negativeControl?.status === "passing";
  const stopSucceeded = Boolean(
    run?.options?.keepTargetRunning ||
      run?.phases?.some((phase) => phase.name === "stop-target" && phase.status === "passing"),
  );
  const restoreSucceeded = Boolean(
    !run?.options?.restoreOriginal ||
      run?.phases?.some((phase) => phase.name === "restore-target-before-state" && phase.status === "passing"),
  );
  const cleanupSucceeded = stopSucceeded && restoreSucceeded;
  const reasonerPresent = Boolean(reasoner?.provider);
  const reasonerReferencesArtifacts = Boolean(
    reasoner?.evidenceReferences?.some((reference) => reference === manifest.files.screenshot) &&
      reasoner?.evidenceReferences?.some((reference) => reference === manifest.files.trace) &&
      reasoner?.evidenceReferences?.some((reference) => reference === manifest.files.candidates),
  );
  const gates = {
    artifactsComplete: artifactCompletenessRatio === 1,
    negativeControlPassed,
    verificationPassing:
      verification?.status === "passing" &&
      verificationAssertions.length > 0 &&
      verificationAssertions.every((assertion) => assertion.pass),
    localizationPresent: Boolean(topCandidate),
    patchRelevant: patchTouchesTopCandidate,
    reasonerPresent,
    reasonerReferencesArtifacts,
    doctorPassing: doctor?.status === "passing",
    runCompleted: run?.status === "passing",
    cleanupSucceeded,
    redactionPassed: redactionReport?.status === "passing" || redactionReport?.status === "warning",
  };
  const score = Math.round(
    artifactCompletenessRatio * 15 +
      verificationPassRate * 25 +
      (gates.negativeControlPassed ? 15 : 0) +
      (gates.localizationPresent ? 10 : 0) +
      (gates.patchRelevant ? 10 : 0) +
      (gates.reasonerPresent ? 10 : 0) +
      (gates.reasonerReferencesArtifacts ? 5 : 0) +
      (gates.doctorPassing ? 5 : 0) +
      (gates.runCompleted ? 3 : 0) +
      (gates.cleanupSucceeded ? 2 : 0),
  );
  const status = Object.values(gates).every(Boolean) ? "passing" : "failing";
  const scorecard: ProofScorecard = {
    caseId: caseFile.id,
    generatedAt: new Date().toISOString(),
    status,
    score,
    metrics: {
      artifactCompletenessRatio,
      verificationPassRate,
      patchTouchesTopCandidate,
      negativeControlPassed,
      reasonerProvider: reasoner?.provider,
      doctorStatus: doctor?.status,
      runStatus: run?.status,
      cleanupSucceeded,
      redactionStatus: redactionReport?.status,
      totalRunDurationMs: run?.durationMs,
      topCandidate,
      changedFiles,
    },
    gates,
    artifactChecks,
    notes: buildScorecardNotes(gates),
  };
  const outPath = resolve(artifactDirectory, "scorecard.json");

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");

  return outPath;
}

export async function generateHypothesisArtifact(caseFile: CaseFile): Promise<string> {
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const manifest = createPlannedArtifactManifest(caseFile);
  const candidates = await readJson<CandidateReport>(manifest.files.candidates);
  const beforeVerification = await readJson<VerificationReport>(manifest.files.beforeVerify);
  const verification = await readJson<VerificationReport>(manifest.files.verify);
  const reasoner = await readJson<ReasonerArtifact>(manifest.files.reasoner);
  const patchText = await readOptionalText(manifest.files.patch);
  const changedFiles = parseChangedFiles(patchText);
  const topCandidate = candidates?.candidates?.[0];
  const verificationAssertions = verification?.assertions ?? [];
  const outPath = resolve(artifactDirectory, "hypothesis.md");
  const lines = [
    "# Repair Hypothesis",
    "",
    `Case: \`${caseFile.id}\``,
    "",
    "## Evidence Read",
    "",
    `- Before screenshot: \`${caseFile.artifacts.directory}/failure.png\``,
    `- Browser trace: \`${caseFile.artifacts.directory}/trace.zip\``,
    `- DOM snapshot: \`${caseFile.artifacts.directory}/dom-snapshot.json\``,
    `- Accessibility tree: \`${caseFile.artifacts.directory}/ax-tree.json\``,
    "",
    "## Localization Hypothesis",
    "",
    topCandidate
      ? `The highest-confidence source candidate is \`${topCandidate.relativeFile}\` with score \`${topCandidate.score ?? "unknown"}\`.`
      : "No source candidate is available yet.",
    ...(topCandidate?.reasons ?? []).map((reason) => `- ${reason}`),
    "",
    "## Root-Cause Hypothesis",
    "",
    reasoner?.diagnosis?.likelyRootCause ??
      "The localized UI container does not correctly respect the intended mobile viewport or layout constraints, which causes a visible frontend break in the reproduced state.",
    "",
    "## Patch Hypothesis",
    "",
    reasoner?.diagnosis?.patchHypothesis ??
      "Apply a focused layout fix in the top localized component and keep the repair bounded to the reproduced failure mode.",
    "",
    "Changed files:",
    ...changedFiles.map((file) => `- \`${file}\``),
    "",
    "## Verification Evidence",
    "",
    `- Before-state negative control: \`${beforeVerification?.negativeControl?.status ?? "missing"}\``,
    `- Verification status: \`${verification?.status ?? "missing"}\``,
    ...verificationAssertions.map((assertion) => {
      const status = assertion.pass ? "pass" : "fail";
      return `- ${status}: ${assertion.name ?? "unnamed assertion"}`;
    }),
    "",
    "## Truth Boundary",
    "",
    "This hypothesis is not proof by itself. The proof is the passing verification artifact plus the before/after browser evidence.",
    ...(reasoner?.diagnosis?.residualRisks ?? []).map((risk) => `- Residual risk: ${risk}`),
    "",
  ];

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join("\n"), "utf8");

  return outPath;
}

async function checkArtifact(key: string, path: string): Promise<ArtifactCheck> {
  try {
    const artifactStat = await stat(path);
    return {
      key,
      path,
      exists: true,
      sizeBytes: artifactStat.size,
    };
  }
  catch {
    return {
      key,
      path,
      exists: false,
      sizeBytes: 0,
    };
  }
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

function buildScorecardNotes(gates: ProofScorecard["gates"]): string[] {
  const notes: string[] = [];

  if (!gates.artifactsComplete) {
    notes.push("One or more required artifacts are missing or empty.");
  }

  if (!gates.verificationPassing) {
    notes.push("Verification is not passing.");
  }

  if (!gates.negativeControlPassed) {
    notes.push("Before-state negative control is missing or did not show the expected failure.");
  }

  if (!gates.localizationPresent) {
    notes.push("No localization candidate is present.");
  }

  if (!gates.patchRelevant) {
    notes.push("Patch does not touch the top localization candidate.");
  }

  if (!gates.reasonerPresent) {
    notes.push("Reasoner artifact is missing.");
  }

  if (!gates.reasonerReferencesArtifacts) {
    notes.push("Reasoner artifact does not cite required evidence files.");
  }

  if (!gates.doctorPassing) {
    notes.push("Environment doctor is not passing.");
  }

  if (!gates.runCompleted) {
    notes.push("Run timeline is not marked passing.");
  }

  if (!gates.cleanupSucceeded) {
    notes.push("Cleanup did not complete or was not recorded.");
  }

  if (!gates.redactionPassed) {
    notes.push("Redaction report is missing or failing.");
  }

  if (notes.length === 0) {
    notes.push("All proof gates passed.");
  }

  return notes;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  catch {
    return undefined;
  }
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  }
  catch {
    return "";
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return Number((numerator / denominator).toFixed(4));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
