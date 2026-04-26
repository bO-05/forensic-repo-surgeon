import { type CaseFile } from "../../schemas/src/index.ts";

type CandidateReport = {
  candidates?: CandidateSummary[];
};

type CandidateSummary = {
  relativeFile?: string;
  score?: number;
  reasons?: string[];
};

type VerificationReport = {
  status?: string;
  assertions?: VerificationAssertion[];
};

type ReasonerArtifact = {
  diagnosis?: {
    likelyRootCause?: string;
    patchHypothesis?: string;
    residualRisks?: string[];
  };
};

type VerificationAssertion = {
  name?: string;
  pass?: boolean;
  expected?: string;
  actual?: unknown;
};

export function renderPrReport(
  caseFile: CaseFile,
  candidateReport?: unknown,
  verificationReport?: unknown,
  reasonerArtifact?: unknown,
  beforeVerificationReport?: unknown,
): string {
  const candidates = parseCandidates(candidateReport);
  const verification = parseVerification(verificationReport);
  const beforeVerification = parseVerification(beforeVerificationReport);
  const reasoner = parseReasoner(reasonerArtifact);
  const verificationPassed = verification?.status === "passing";

  return [
    "# Bug",
    "",
    caseFile.input.note,
    "",
    "# Repro",
    "",
    `- Route: \`${caseFile.route}\``,
    `- Viewport: \`${caseFile.viewport.name} (${caseFile.viewport.width}x${caseFile.viewport.height})\``,
    `- Auth mode: \`${caseFile.auth.mode}\``,
    "- Steps:",
    ...caseFile.repro.steps.map((step) => `  - ${step}`),
    "",
    "# Root Cause",
    "",
    verificationPassed
      ? reasoner?.diagnosis?.likelyRootCause ??
        "The localized UI container did not respect the intended mobile viewport or layout constraints, which produced the reproduced visible failure."
      : candidates.length > 0
        ? `Needs code inspection. Current top source candidate: \`${candidates[0]?.relativeFile}\`.`
        : "Pending implementation.",
    "",
    `- Reasoner artifact: \`${caseFile.artifacts.directory}/reasoner.md\``,
    `- Reasoner JSON: \`${caseFile.artifacts.directory}/reasoner.json\``,
    `- Evidence integrity: \`${caseFile.artifacts.directory}/evidence-manifest.md\``,
    `- Hypothesis artifact: \`${caseFile.artifacts.directory}/hypothesis.md\``,
    "",
    "# Source Localization",
    "",
    `- Candidate artifact: \`${caseFile.artifacts.directory}/candidates.json\``,
    ...renderCandidateLines(candidates),
    "",
    "# Fix",
    "",
    verificationPassed
      ? reasoner?.diagnosis?.patchHypothesis ??
        "Apply a focused layout fix in the top localized component so the reproduced UI failure no longer occurs."
      : "Pending implementation.",
    "",
    "# Changed Files",
    "",
    verificationPassed && candidates[0]?.relativeFile
      ? `- \`${candidates[0].relativeFile}\``
      : "- Pending implementation.",
    `- Patch: \`${caseFile.artifacts.directory}/patch.diff\``,
    "",
    "# Before Evidence",
    "",
    `- Screenshot: \`${caseFile.artifacts.directory}/failure.png\``,
    `- Negative control: \`${caseFile.artifacts.directory}/${caseFile.verification.negativeControl?.artifact ?? "before-verify.json"}\``,
    `- Trace: \`${caseFile.artifacts.directory}/trace.zip\``,
    `- Console: \`${caseFile.artifacts.directory}/console.ndjson\``,
    `- Network: \`${caseFile.artifacts.directory}/network.ndjson\``,
    "",
    "# After Evidence",
    "",
    `- Screenshot: \`${caseFile.artifacts.directory}/success.png\``,
    `- Verification: \`${caseFile.artifacts.directory}/verify.json\``,
    `- Validation dossier: \`${caseFile.artifacts.directory}/index.html\``,
    "",
    "# Verification",
    "",
    "- Models advise, verifiers decide.",
    "- Agents create diffs. Forensic Repo Surgeon creates inspectable proof.",
    `- Proof scorecard: \`${caseFile.artifacts.directory}/scorecard.json\``,
    `- Run timeline: \`${caseFile.artifacts.directory}/run.json\``,
    ...(beforeVerification ? renderNegativeControlLines(beforeVerification) : []),
    ...(verification ? renderVerificationLines(verification) : []),
    ...caseFile.verification.mustPass.map((item) => `- ${item}`),
    "",
    "# Residual Risk",
    "",
    verificationPassed
      ? reasoner?.diagnosis?.residualRisks?.join(" ") ??
        "Verified on the locked viewport for this case. Before upstreaming, recheck adjacent breakpoints and related flows."
      : "Pending implementation.",
    "",
  ].join("\n");
}

function parseCandidates(candidateReport: unknown): CandidateSummary[] {
  const report = candidateReport as CandidateReport | undefined;

  if (!report || !Array.isArray(report.candidates)) {
    return [];
  }

  return report.candidates
    .filter((candidate) => typeof candidate.relativeFile === "string")
    .slice(0, 5);
}

function renderCandidateLines(candidates: CandidateSummary[]): string[] {
  if (candidates.length === 0) {
    return ["- Top candidates: pending localization run."];
  }

  return candidates.map((candidate) => {
    const reason = candidate.reasons?.[0] ?? "matches evidence signals";
    return `- \`${candidate.relativeFile}\` score ${candidate.score ?? "unknown"}: ${reason}`;
  });
}

function parseVerification(verificationReport: unknown): VerificationReport | undefined {
  const report = verificationReport as VerificationReport | undefined;

  if (!report || typeof report.status !== "string") {
    return undefined;
  }

  return report;
}

function parseReasoner(reasonerArtifact: unknown): ReasonerArtifact | undefined {
  const artifact = reasonerArtifact as ReasonerArtifact | undefined;

  if (!artifact || typeof artifact !== "object") {
    return undefined;
  }

  return artifact;
}

function renderVerificationLines(verification: VerificationReport): string[] {
  const lines = [`- Verification status: \`${verification.status}\``];

  for (const assertion of verification.assertions ?? []) {
    const status = assertion.pass ? "pass" : "fail";
    lines.push(`- ${status}: ${assertion.name ?? "unnamed assertion"}`);
  }

  return lines;
}

function renderNegativeControlLines(verification: VerificationReport): string[] {
  const failedAssertions = (verification.assertions ?? [])
    .filter((assertion) => !assertion.pass)
    .map((assertion) => assertion.name ?? "unnamed assertion");

  return [
    `- Before-state verification status: \`${verification.status}\``,
    `- Expected before-state failures observed: ${failedAssertions.length ? failedAssertions.map((name) => `\`${name}\``).join(", ") : "`none`"}`,
  ];
}
