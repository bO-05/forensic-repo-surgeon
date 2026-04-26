import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

type ScorecardLike = {
  status?: string;
  score?: number;
  metrics?: Record<string, unknown>;
  gates?: Record<string, boolean>;
};

type VerificationLike = {
  status?: string;
  assertions?: Array<{
    name?: string;
    pass?: boolean;
  }>;
  negativeControl?: {
    status?: string;
    matchedExpectedFailures?: string[];
  };
};

export type GithubCheckInput = {
  caseId: string;
  title: string;
  scorecard: ScorecardLike;
  beforeVerification?: VerificationLike;
  verification?: VerificationLike;
  files: {
    scorecard: string;
    beforeVerify: string;
    verify: string;
    screenshot: string;
    success: string;
    trace: string;
    redactionReport: string;
  };
  residualRisks?: string[];
};

export type GithubCheckPayload = {
  caseId: string;
  title: string;
  conclusion: "success" | "failure" | "neutral";
  summary: {
    status?: string;
    score?: number;
    verificationStatus?: string;
    beforeNegativeControlStatus?: string;
    redactionReport: string;
  };
  failedGates: string[];
  artifacts: GithubCheckInput["files"];
  residualRisks: string[];
};

export async function generateGithubCheckSummary(caseFile: CaseFile): Promise<string> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const input = await loadGithubCheckInput(caseFile);
  const markdownPath = resolve(manifest.files.githubCheckMarkdown);
  const jsonPath = resolve(manifest.files.githubCheckJson);

  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, renderGithubCheckMarkdown(input), "utf8");
  await writeFile(jsonPath, `${JSON.stringify(renderGithubCheckJson(input), null, 2)}\n`, "utf8");

  return markdownPath;
}

export function renderGithubCheckMarkdown(input: GithubCheckInput): string {
  const payload = renderGithubCheckJson(input);
  const assertionCount = input.verification?.assertions?.length ?? 0;
  const passingAssertions = input.verification?.assertions?.filter((assertion) => assertion.pass).length ?? 0;

  return [
    `# Forensic Repo Surgeon: ${input.title}`,
    "",
    `- Case: \`${input.caseId}\``,
    `- Conclusion: \`${payload.conclusion}\``,
    `- Scorecard: \`${input.scorecard.status ?? "missing"}\` score \`${input.scorecard.score ?? "n/a"}\``,
    `- Before-state negative control: \`${payload.summary.beforeNegativeControlStatus ?? "missing"}\``,
    `- Verification: \`${payload.summary.verificationStatus ?? "missing"}\` (${passingAssertions}/${assertionCount} assertions passing)`,
    `- Redaction report: \`${input.files.redactionReport}\``,
    "",
    "## Proof Artifacts",
    "",
    `- Scorecard: \`${input.files.scorecard}\``,
    `- Before verification: \`${input.files.beforeVerify}\``,
    `- After verification: \`${input.files.verify}\``,
    `- Before screenshot: \`${input.files.screenshot}\``,
    `- After screenshot: \`${input.files.success}\``,
    `- Playwright trace: \`${input.files.trace}\``,
    "",
    "## Failed Gates",
    "",
    ...(payload.failedGates.length ? payload.failedGates.map((gate) => `- \`${gate}\``) : ["- none"]),
    "",
    "## Residual Risks",
    "",
    ...(payload.residualRisks.length ? payload.residualRisks.map((risk) => `- ${risk}`) : ["- none recorded"]),
    "",
  ].join("\n");
}

export function renderGithubCheckJson(input: GithubCheckInput): GithubCheckPayload {
  const failedGates = Object.entries(input.scorecard.gates ?? {})
    .filter(([, passed]) => !passed)
    .map(([gate]) => gate);

  return {
    caseId: input.caseId,
    title: input.title,
    conclusion: input.scorecard.status === "passing" ? "success" : "failure",
    summary: {
      status: input.scorecard.status,
      score: input.scorecard.score,
      verificationStatus: input.verification?.status,
      beforeNegativeControlStatus: input.beforeVerification?.negativeControl?.status,
      redactionReport: input.files.redactionReport,
    },
    failedGates,
    artifacts: input.files,
    residualRisks: input.residualRisks ?? [],
  };
}

async function loadGithubCheckInput(caseFile: CaseFile): Promise<GithubCheckInput> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const [scorecard, beforeVerification, verification, reasoner] = await Promise.all([
    readJson<ScorecardLike>(manifest.files.scorecard),
    readJson<VerificationLike>(manifest.files.beforeVerify),
    readJson<VerificationLike>(manifest.files.verify),
    readJson<{ diagnosis?: { residualRisks?: string[] } }>(manifest.files.reasoner),
  ]);

  return {
    caseId: caseFile.id,
    title: caseFile.title,
    scorecard: scorecard ?? {},
    beforeVerification,
    verification,
    files: {
      scorecard: manifest.files.scorecard,
      beforeVerify: manifest.files.beforeVerify,
      verify: manifest.files.verify,
      screenshot: manifest.files.screenshot,
      success: manifest.files.success,
      trace: manifest.files.trace,
      redactionReport: manifest.files.redactionReport,
    },
    residualRisks: reasoner?.diagnosis?.residualRisks ?? [],
  };
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  catch {
    return undefined;
  }
}
