import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

type CandidateReport = {
  candidates?: Array<{
    rank?: number;
    relativeFile?: string;
    score?: number;
    reasons?: string[];
    matchedSignals?: Array<{
      kind?: string;
      value?: string;
      line?: number;
      weight?: number;
    }>;
  }>;
};

type Candidate = NonNullable<CandidateReport["candidates"]>[number];

type ReasonerArtifact = {
  caseId: string;
  generatedAt: string;
  provider: "deterministic-fallback" | "anthropic-messages-api";
  liveModelUsed: boolean;
  model?: string;
  requestId?: string;
  latencyMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  recordedRunNote: string;
  intendedModelBoundary: "claude-code-or-anthropic-api";
  truthBoundary: string;
  evidenceReferences: string[];
  topCandidate?: {
    relativeFile?: string;
    score?: number;
    reasons: string[];
  };
  diagnosis: {
    symptom: string;
    likelyRootCause: string;
    patchHypothesis: string;
    verificationPlan: string[];
    residualRisks: string[];
  };
};

export type Reasoner = {
  id: string;
  generate(caseFile: CaseFile): Promise<ReasonerArtifact>;
};

type AnthropicsMessageResponse = {
  id?: string;
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

type ReasonerInputs = {
  caseFile: CaseFile;
  manifest: ReturnType<typeof createPlannedArtifactManifest>;
  candidates?: CandidateReport;
  consoleRecords: NdjsonRecord[];
};

type NdjsonRecord = {
  type?: string;
  text?: string;
};

type ReasonerDiagnosis = ReasonerArtifact["diagnosis"];

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-7";
const DEFAULT_ANTHROPIC_MAX_TOKENS = 900;

export function createDeterministicReasoner(): Reasoner {
  return {
    id: "deterministic-fallback",
    async generate(caseFile) {
      const inputs = await loadReasonerInputs(caseFile);
      return buildDeterministicArtifact(inputs);
    },
  };
}

export function createReasonerFromEnvironment(): Reasoner {
  const configuredProvider = (process.env.SURGEON_REASONER_PROVIDER ?? "auto").trim().toLowerCase();
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);

  if ((configuredProvider === "auto" || configuredProvider === "anthropic") && hasAnthropicKey) {
    return createAnthropicReasoner();
  }

  return createDeterministicReasoner();
}

export function createAnthropicReasoner(): Reasoner {
  return {
    id: "anthropic-messages-api",
    async generate(caseFile) {
      const inputs = await loadReasonerInputs(caseFile);
      const apiKey = process.env.ANTHROPIC_API_KEY;
      const model = process.env.SURGEON_REASONER_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
      const maxTokens = parsePositiveInt(process.env.SURGEON_REASONER_MAX_TOKENS) ?? DEFAULT_ANTHROPIC_MAX_TOKENS;

      if (!apiKey) {
        return buildDeterministicArtifact(inputs, {
          recordedRunNote:
            "Anthropic provider was requested, but ANTHROPIC_API_KEY is missing. The reasoner artifact was produced by deterministic fallback synthesis over the captured evidence files.",
        });
      }

      const prompt = buildAnthropicPrompt(inputs);
      const startedAt = Date.now();

      try {
        const response = await fetch(ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system:
              "You are a frontend bug reasoning engine. Return strict JSON only. Ground every claim in the supplied evidence. Do not claim visual or code certainty beyond the evidence.",
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        });
        const latencyMs = Date.now() - startedAt;

        if (!response.ok) {
          const errorBody = await response.text();
          return buildDeterministicArtifact(inputs, {
            recordedRunNote:
              `Anthropic request failed with HTTP ${response.status}. Deterministic fallback was used instead.`,
            residualRisk:
              `Anthropic request failed with HTTP ${response.status}. Response excerpt digest ${digestText(errorBody)}.`,
          });
        }

        const payload = (await response.json()) as AnthropicsMessageResponse;
        const responseText = extractAnthropicText(payload);
        const diagnosis = parseAnthropicDiagnosis(responseText);

        return {
          caseId: caseFile.id,
          generatedAt: new Date().toISOString(),
          provider: "anthropic-messages-api",
          liveModelUsed: true,
          model: payload.model ?? model,
          requestId: response.headers.get("request-id") ?? undefined,
          latencyMs,
          usage: {
            inputTokens: payload.usage?.input_tokens,
            outputTokens: payload.usage?.output_tokens,
          },
          recordedRunNote:
            "This recorded run used the Anthropic Messages API to generate the reasoner diagnosis from summarized evidence artifacts.",
          intendedModelBoundary: "claude-code-or-anthropic-api",
          truthBoundary:
            "The reasoner proposes and explains. Deterministic verification, doctor, run timeline, and scorecard decide acceptance.",
          evidenceReferences: buildEvidenceReferences(inputs.manifest),
          topCandidate: toTopCandidate(inputs.candidates?.candidates?.[0]),
          diagnosis: normalizeDiagnosis(diagnosis, inputs),
        };
      }
      catch (error) {
        return buildDeterministicArtifact(inputs, {
          recordedRunNote:
            "Anthropic request failed before a valid response was returned. Deterministic fallback was used instead.",
          residualRisk: `Anthropic error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}

export async function generateReasonerArtifacts(
  caseFile: CaseFile,
  reasoner: Reasoner = createReasonerFromEnvironment(),
): Promise<string> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const artifact = await reasoner.generate(caseFile);
  const jsonPath = resolve(manifest.files.reasoner);
  const mdPath = resolve(manifest.files.reasonerReport);

  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(mdPath, renderReasonerMarkdown(artifact), "utf8");

  return jsonPath;
}

function renderReasonerMarkdown(artifact: ReasonerArtifact): string {
  const lines = [
    "# Reasoning Boundary",
    "",
    `Case: \`${artifact.caseId}\``,
    `Provider: \`${artifact.provider}\``,
    `Live model used: \`${artifact.liveModelUsed ? "yes" : "no"}\``,
    `Model: \`${artifact.model ?? "n/a"}\``,
    `Request id: \`${artifact.requestId ?? "n/a"}\``,
    `Latency: \`${typeof artifact.latencyMs === "number" ? `${artifact.latencyMs}ms` : "n/a"}\``,
    `Usage: \`input ${artifact.usage?.inputTokens ?? "n/a"} / output ${artifact.usage?.outputTokens ?? "n/a"}\``,
    `Intended model boundary: \`${artifact.intendedModelBoundary}\``,
    "",
    artifact.recordedRunNote,
    "",
    "## Truth Boundary",
    "",
    artifact.truthBoundary,
    "",
    "## Evidence References",
    "",
    ...artifact.evidenceReferences.map((reference) => `- \`${reference}\``),
    "",
    "## Top Source Candidate",
    "",
    artifact.topCandidate
      ? `- \`${artifact.topCandidate.relativeFile}\` score \`${artifact.topCandidate.score ?? "unknown"}\``
      : "- No top candidate was available.",
    ...(artifact.topCandidate?.reasons ?? []).map((reason) => `- ${reason}`),
    "",
    "## Diagnosis",
    "",
    `- Symptom: ${artifact.diagnosis.symptom}`,
    `- Likely root cause: ${artifact.diagnosis.likelyRootCause}`,
    `- Patch hypothesis: ${artifact.diagnosis.patchHypothesis}`,
    "",
    "## Verification Plan",
    "",
    ...artifact.diagnosis.verificationPlan.map((item) => `- ${item}`),
    "",
    "## Residual Risks",
    "",
    ...artifact.diagnosis.residualRisks.map((item) => `- ${item}`),
    "",
  ];

  return lines.join("\n");
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  catch {
    return undefined;
  }
}

async function readNdjson(path: string): Promise<NdjsonRecord[]> {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as NdjsonRecord);
  }
  catch {
    return [];
  }
}

async function loadReasonerInputs(caseFile: CaseFile): Promise<ReasonerInputs> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const [candidates, consoleRecords] = await Promise.all([
    readJson<CandidateReport>(manifest.files.candidates),
    readNdjson(manifest.files.console),
  ]);

  return {
    caseFile,
    manifest,
    candidates,
    consoleRecords,
  };
}

function buildDeterministicArtifact(
  inputs: ReasonerInputs,
  overrides?: {
    recordedRunNote?: string;
    residualRisk?: string;
  },
): ReasonerArtifact {
  const topCandidate = inputs.candidates?.candidates?.[0];
  const diagnosis = buildDeterministicDiagnosis(inputs, overrides?.residualRisk);

  return {
    caseId: inputs.caseFile.id,
    generatedAt: new Date().toISOString(),
    provider: "deterministic-fallback",
    liveModelUsed: false,
    recordedRunNote:
      overrides?.recordedRunNote ??
      "This recorded run did not call a live Anthropic API. The reasoner artifact was produced by deterministic fallback synthesis over the captured evidence files.",
    intendedModelBoundary: "claude-code-or-anthropic-api",
    truthBoundary:
      "The reasoner proposes and explains. Deterministic verification, doctor, run timeline, and scorecard decide acceptance.",
    evidenceReferences: buildEvidenceReferences(inputs.manifest),
    topCandidate: toTopCandidate(topCandidate),
    diagnosis,
  };
}

function buildEvidenceReferences(manifest: ReturnType<typeof createPlannedArtifactManifest>): string[] {
  return [
    manifest.files.screenshot,
    manifest.files.trace,
    manifest.files.console,
    manifest.files.network,
    manifest.files.axTree,
    manifest.files.domSnapshot,
    manifest.files.candidates,
    manifest.files.patch,
    manifest.files.verify,
  ];
}

function toTopCandidate(topCandidate: Candidate | undefined): ReasonerArtifact["topCandidate"] {
  if (!topCandidate) {
    return undefined;
  }

  return {
    relativeFile: topCandidate.relativeFile,
    score: topCandidate.score,
    reasons: topCandidate.reasons ?? [],
  };
}

function buildAnthropicPrompt(inputs: ReasonerInputs): string {
  const topCandidates = (inputs.candidates?.candidates ?? []).slice(0, 3);
  const consoleSummary = summarizeConsoleRecords(inputs.consoleRecords);

  return [
    "Return strict JSON with keys: symptom, likelyRootCause, patchHypothesis, verificationPlan, residualRisks.",
    "verificationPlan and residualRisks must be arrays of short strings.",
    "",
    `Case id: ${inputs.caseFile.id}`,
    `Title: ${inputs.caseFile.title}`,
    `Route: ${inputs.caseFile.route}`,
    `Viewport: ${inputs.caseFile.viewport.name} (${inputs.caseFile.viewport.width}x${inputs.caseFile.viewport.height})`,
    `Auth mode: ${inputs.caseFile.auth.mode}`,
    `Bug note: ${inputs.caseFile.input.note}`,
    "",
    "Top source candidates:",
    ...topCandidates.map((candidate, index) =>
      `${index + 1}. ${candidate.relativeFile ?? "unknown"} score ${candidate.score ?? "unknown"} reasons: ${(candidate.reasons ?? []).join("; ")}`,
    ),
    "",
    "Console summary:",
    `- warnings: ${consoleSummary.warningCount}`,
    `- errors: ${consoleSummary.errorCount}`,
    ...consoleSummary.examples.map((example) => `- ${example}`),
    "",
    "Evidence references:",
    ...buildEvidenceReferences(inputs.manifest).map((reference) => `- ${reference}`),
    "",
    "Constraints:",
    "- Keep the reasoning scoped to the supplied evidence.",
    "- Do not claim certainty from screenshots alone.",
    "- Propose a focused patch hypothesis, not a refactor.",
  ].join("\n");
}

function summarizeConsoleRecords(records: NdjsonRecord[]): {
  warningCount: number;
  errorCount: number;
  examples: string[];
} {
  const warnings = records.filter((record) => record.type === "warning");
  const errors = records.filter((record) => record.type === "error");
  const examples = [...warnings, ...errors]
    .slice(0, 4)
    .map((record) => truncateWhitespace(record.text ?? "unknown console event", 180));

  return {
    warningCount: warnings.length,
    errorCount: errors.length,
    examples,
  };
}

function extractAnthropicText(payload: AnthropicsMessageResponse): string {
  const text = payload.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Anthropic response did not include text content.");
  }

  return text;
}

function parseAnthropicDiagnosis(text: string): ReasonerDiagnosis {
  const normalized = stripMarkdownCodeFence(text);
  const parsed = JSON.parse(normalized) as Partial<ReasonerDiagnosis>;

  return {
    symptom: String(parsed.symptom ?? ""),
    likelyRootCause: String(parsed.likelyRootCause ?? ""),
    patchHypothesis: String(parsed.patchHypothesis ?? ""),
    verificationPlan: Array.isArray(parsed.verificationPlan)
      ? parsed.verificationPlan.map((item) => String(item))
      : [],
    residualRisks: Array.isArray(parsed.residualRisks)
      ? parsed.residualRisks.map((item) => String(item))
      : [],
  };
}

function normalizeDiagnosis(diagnosis: ReasonerDiagnosis, inputs: ReasonerInputs): ReasonerDiagnosis {
  const fallback = buildDeterministicArtifact(inputs).diagnosis;

  return {
    symptom: diagnosis.symptom || fallback.symptom,
    likelyRootCause: diagnosis.likelyRootCause || fallback.likelyRootCause,
    patchHypothesis: diagnosis.patchHypothesis || fallback.patchHypothesis,
    verificationPlan: diagnosis.verificationPlan.length > 0 ? diagnosis.verificationPlan : fallback.verificationPlan,
    residualRisks: diagnosis.residualRisks.length > 0 ? diagnosis.residualRisks : fallback.residualRisks,
  };
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "").trim();
}

function truncateWhitespace(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildDeterministicDiagnosis(
  inputs: ReasonerInputs,
  residualRisk: string | undefined,
): ReasonerDiagnosis {
  const sharedResidualRisks = [
    "Adjacent mobile viewport sizes are not exhaustively checked.",
    residualRisk ?? "The deterministic fallback summarizes evidence; a Claude provider should be added for live model reasoning.",
  ];

  if (inputs.caseFile.workflow === "crwa-mobile-onboarding-dialog") {
    return {
      symptom:
        "A newly created mobile user reaches the onboarding dialog where the first-step content and action row can overflow horizontally.",
      likelyRootCause:
        "The onboarding dialog keeps step-one illustration and copy in a row layout on mobile, and the logout button applies oversized right padding that pushes the action row beyond the viewport.",
      patchHypothesis:
        "Stack the onboarding content vertically on small screens, constrain SVG width, and replace the oversized logout padding with a full-width mobile action layout.",
      verificationPlan: [
        "Create a fresh user through the signup flow and sign in on the same mobile viewport.",
        "Assert the onboarding dialog is visible.",
        "Assert the logout and next buttons stay inside the 390x844 viewport.",
        "Assert the onboarding action buttons do not overlap and the page has no horizontal overflow.",
        "Capture an after screenshot and machine-readable verification report.",
      ],
      residualRisks: [
        "Step two bank-account creation and step three completion are not exhaustively checked.",
        "Desktop onboarding spacing should be reviewed before upstreaming.",
        ...sharedResidualRisks,
      ],
    };
  }

  return {
    symptom:
      "Authenticated mobile transaction feed opens a date-range drawer where the calendar can be clipped outside the visible viewport.",
    likelyRootCause:
      "The Material UI bottom drawer and calendar wrapper are not bounded to the mobile viewport, so the date picker content can extend below the screen.",
    patchHypothesis:
      "Constrain the drawer paper to full viewport height and make the date-range calendar wrapper viewport-bounded and scrollable.",
    verificationPlan: [
      "Rerun the same authenticated mobile workflow.",
      "Assert the drawer is visible.",
      "Assert the drawer close button is visible.",
      "Assert the calendar container remains inside the 390x844 viewport.",
      "Capture an after screenshot and machine-readable verification report.",
    ],
    residualRisks: [
      "Desktop popover behavior should be reviewed before upstreaming.",
      ...sharedResidualRisks,
    ],
  };
}
