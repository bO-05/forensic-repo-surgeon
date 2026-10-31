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

type VerificationReport = {
  status?: string;
  assertions?: Array<{
    name?: string;
    pass?: boolean;
    expected?: string;
    actual?: unknown;
  }>;
  negativeControl?: {
    status?: string;
    expectedFailures?: string[];
    actualFailures?: string[];
    matchedExpectedFailures?: string[];
  };
};

type Scorecard = {
  status?: string;
  score?: number;
  generatedAt?: string;
  metrics?: {
    artifactCompletenessRatio?: number;
    verificationPassRate?: number;
    patchTouchesTopCandidate?: boolean;
    negativeControlPassed?: boolean;
    cleanupSucceeded?: boolean;
    topCandidate?: string;
    changedFiles?: string[];
  };
  gates?: Record<string, boolean>;
  notes?: string[];
};

type RunTimeline = {
  status?: string;
  durationMs?: number;
  phases?: Array<{
    name?: string;
    status?: string;
    durationMs?: number;
  }>;
};

type DoctorReport = {
  status?: string;
  checks?: Array<{
    name?: string;
    status?: string;
    detail?: string;
    remedy?: string;
  }>;
};

type ReasonerArtifact = {
  provider?: string;
  liveModelUsed?: boolean;
  model?: string;
  requestId?: string;
  latencyMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  recordedRunNote?: string;
  intendedModelBoundary?: string;
  truthBoundary?: string;
  evidenceReferences?: string[];
  diagnosis?: {
    symptom?: string;
    likelyRootCause?: string;
    patchHypothesis?: string;
    verificationPlan?: string[];
    residualRisks?: string[];
  };
};

type ModelAgentTrace = {
  status?: string;
  liveModelUsed?: boolean;
  provider?: string;
  model?: string;
  sessionId?: string;
  loadedTools?: string[];
  totalTurns?: number;
  totalToolCalls?: number;
  filesRead?: string[];
  filesEdited?: string[];
  durationMs?: number;
  durationApiMs?: number;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  finalAssistantText?: string;
  resultSubtype?: string;
  errors?: string[];
  permissionDenials?: Array<{ toolName?: string }>;
  patchByteLength?: number;
  recordedRunNote?: string;
  truthBoundary?: string;
  turns?: Array<{
    turnIndex?: number;
    textBlocks?: string[];
    toolCalls?: Array<{
      name?: string;
      input?: Record<string, unknown>;
      isError?: boolean;
    }>;
  }>;
};

type ModelScorecard = {
  status?: string;
  score?: number;
  source?: string;
  generatedAt?: string;
  metrics?: {
    verificationPassRate?: number;
    patchTouchesTopCandidate?: boolean;
    patchByteLength?: number;
    changedFiles?: string[];
    durationMs?: number;
  };
  gates?: {
    patchProvided?: boolean;
    patchApplies?: boolean;
    verificationPassing?: boolean;
    patchRelevant?: boolean;
  };
  notes?: string[];
};

export async function generateArtifactViewer(caseFile: CaseFile): Promise<string> {
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const manifest = createPlannedArtifactManifest(caseFile);
  const candidates = await readJson<CandidateReport>(manifest.files.candidates);
  const beforeVerification = await readJson<VerificationReport>(manifest.files.beforeVerify);
  const verification = await readJson<VerificationReport>(manifest.files.verify);
  const scorecard = await readJson<Scorecard>(manifest.files.scorecard);
  const run = await readJson<RunTimeline>(manifest.files.run);
  const doctor = await readJson<DoctorReport>(manifest.files.doctor);
  const reasoner = await readJson<ReasonerArtifact>(manifest.files.reasoner);
  const hypothesis = await readOptionalText(manifest.files.hypothesis);
  const reasonerReport = await readOptionalText(manifest.files.reasonerReport);
  const evidenceReport = await readOptionalText(manifest.files.evidenceReport);
  const patch = await readOptionalText(manifest.files.patch);
  // Side-by-side: model-authored patch artifacts (only present when --live-opus runs).
  const modelTrace = await readJson<ModelAgentTrace>(manifest.files.modelTrace);
  const modelScorecard = await readJson<ModelScorecard>(manifest.files.modelScorecard);
  const modelPatch = await readOptionalText(manifest.files.modelPatch);
  const outPath = resolve(manifest.files.viewer);

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    renderViewerHtml({
      caseFile,
      candidates,
      beforeVerification,
      verification,
      scorecard,
      run,
      doctor,
      reasoner,
      hypothesis,
      reasonerReport,
      evidenceReport,
      patch,
      modelTrace,
      modelScorecard,
      modelPatch,
    }),
    "utf8",
  );

  return outPath;
}

function renderViewerHtml({
  caseFile,
  candidates,
  beforeVerification,
  verification,
  scorecard,
  run,
  doctor,
  reasoner,
  hypothesis,
  reasonerReport,
  evidenceReport,
  patch,
  modelTrace,
  modelScorecard,
  modelPatch,
}: {
  caseFile: CaseFile;
  candidates?: CandidateReport;
  beforeVerification?: VerificationReport;
  verification?: VerificationReport;
  scorecard?: Scorecard;
  run?: RunTimeline;
  doctor?: DoctorReport;
  reasoner?: ReasonerArtifact;
  hypothesis: string;
  reasonerReport: string;
  evidenceReport: string;
  patch: string;
  modelTrace?: ModelAgentTrace;
  modelScorecard?: ModelScorecard;
  modelPatch: string;
}): string {
  const topCandidates = candidates?.candidates?.slice(0, 5) ?? [];
  const beforeAssertions = beforeVerification?.assertions ?? [];
  const assertions = verification?.assertions ?? [];
  const gates = scorecard?.gates ?? {};
  const changedFiles = scorecard?.metrics?.changedFiles ?? [];
  const doctorChecks = doctor?.checks ?? [];
  const evidenceReferences = reasoner?.evidenceReferences ?? [];
  const statusClass = scorecard?.status === "passing" ? "pass" : "fail";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Forensic Repo Surgeon Dossier - ${escapeHtml(caseFile.id)}</title>
  <style>
    :root {
      --ink: #17130d;
      --paper: #f3ead8;
      --paper-deep: #dfcfaf;
      --charcoal: #25221d;
      --line: #8f7f5d;
      --green: #2f6f4e;
      --red: #9d2e24;
      --amber: #c17817;
      --blueprint: #193a4a;
      --white: #fffaf0;
      --shadow: 0 22px 70px rgba(23, 19, 13, 0.22);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      overflow-wrap: anywhere;
      color: var(--ink);
      background:
        radial-gradient(circle at 16% 12%, rgba(193, 120, 23, 0.18), transparent 30%),
        linear-gradient(135deg, rgba(25, 58, 74, 0.18) 0 1px, transparent 1px 24px),
        var(--paper);
      font-family: Georgia, Cambria, "Times New Roman", serif;
    }

    a {
      color: inherit;
    }

    .shell {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 34px 0 56px;
    }

    .hero {
      position: relative;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      padding: 34px;
      border: 2px solid var(--ink);
      background: linear-gradient(120deg, rgba(255, 250, 240, 0.96), rgba(223, 207, 175, 0.94));
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: auto -80px -120px auto;
      width: 320px;
      height: 320px;
      border: 32px solid rgba(37, 34, 29, 0.08);
      transform: rotate(17deg);
    }

    .eyebrow {
      margin: 0 0 10px;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      max-width: 820px;
      font-size: clamp(40px, 6vw, 82px);
      line-height: 0.88;
      letter-spacing: -0.06em;
    }

    .subtitle {
      max-width: 760px;
      margin: 18px 0 0;
      font-size: 19px;
      line-height: 1.45;
    }

    .stamp {
      align-self: start;
      min-width: 178px;
      padding: 18px;
      border: 2px solid currentColor;
      transform: rotate(2deg);
      text-align: center;
      font-family: "Cascadia Code", Consolas, monospace;
      background: var(--white);
    }

    .stamp.pass {
      color: var(--green);
    }

    .stamp.fail {
      color: var(--red);
    }

    .stamp strong {
      display: block;
      font-size: 42px;
      letter-spacing: -0.08em;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 18px;
      margin-top: 22px;
    }

    .card {
      grid-column: span 6;
      padding: 22px;
      border: 1px solid rgba(23, 19, 13, 0.28);
      background: rgba(255, 250, 240, 0.88);
      box-shadow: 0 12px 34px rgba(23, 19, 13, 0.08);
    }

    .card.wide {
      grid-column: span 12;
    }

    .card.third {
      grid-column: span 4;
    }

    .card h2 {
      margin: 0 0 16px;
      font-size: 28px;
      letter-spacing: -0.04em;
    }

    .kpi {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }

    .metric {
      padding: 14px;
      border: 1px solid rgba(23, 19, 13, 0.24);
      background: var(--charcoal);
      color: var(--white);
      min-height: 104px;
    }

    .metric span {
      display: block;
      color: rgba(255, 250, 240, 0.66);
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    .metric strong {
      display: block;
      margin-top: 14px;
      font-size: 30px;
      letter-spacing: -0.05em;
    }

    .shots {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }

    figure {
      margin: 0;
    }

    figure img {
      width: 100%;
      max-height: 760px;
      object-fit: contain;
      border: 2px solid var(--ink);
      background: #111;
    }

    figcaption {
      margin-top: 8px;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .list li {
      padding: 12px 14px;
      border-left: 5px solid var(--line);
      background: rgba(223, 207, 175, 0.42);
    }

    .list li.pass {
      border-left-color: var(--green);
    }

    .list li.fail {
      border-left-color: var(--red);
    }

    .list li.warning {
      border-left-color: var(--amber);
    }

    .mono,
    pre,
    code {
      font-family: "Cascadia Code", Consolas, monospace;
    }

    pre {
      max-height: 420px;
      margin: 0;
      padding: 18px;
      overflow: auto;
      color: #f7f0df;
      background: #16130f;
      border: 1px solid rgba(23, 19, 13, 0.4);
      line-height: 1.45;
      white-space: pre-wrap;
    }

    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .links a {
      display: inline-flex;
      padding: 10px 12px;
      border: 1px solid var(--ink);
      background: var(--white);
      text-decoration: none;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .timeline {
      counter-reset: step;
    }

    .timeline li {
      position: relative;
      padding-left: 56px;
    }

    .timeline li::before {
      counter-increment: step;
      content: counter(step);
      position: absolute;
      left: 12px;
      top: 11px;
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: var(--blueprint);
      color: var(--white);
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 12px;
    }

    @media (max-width: 860px) {
      .hero,
      .shots,
      .kpi {
        grid-template-columns: 1fr;
      }

      .card,
      .card.third {
        grid-column: span 12;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Forensic Repo Surgeon validation dossier</p>
        <h1>${escapeHtml(caseFile.title)}</h1>
        <p class="subtitle">${escapeHtml(caseFile.input.note)} This page is generated from artifacts only; raw files are linked for audit.</p>
      </div>
      <div class="stamp ${statusClass}">
        <span>scorecard</span>
        <strong>${escapeHtml(String(scorecard?.score ?? "??"))}</strong>
        <span>${escapeHtml(scorecard?.status ?? "missing")}</span>
      </div>
    </section>

    <section class="grid">
      <article class="card wide">
        <h2>Proof Gates</h2>
        <div class="kpi">
          ${renderMetric(percent(scorecard?.metrics?.artifactCompletenessRatio), "required files present", "artifacts")}
          ${renderMetric(yesNo(scorecard?.metrics?.negativeControlPassed), "expected failure observed", "before control")}
          ${renderMetric(percent(scorecard?.metrics?.verificationPassRate), "assertions pass", "verification")}
          ${renderMetric(yesNo(scorecard?.metrics?.patchTouchesTopCandidate), "touches top candidate", "patch relevance")}
          ${renderMetric(formatDuration(run?.durationMs), scorecard?.metrics?.cleanupSucceeded ? "cleanup passed" : "cleanup missing", "run duration")}
        </div>
      </article>

      <article class="card wide">
        <h2>Before And After</h2>
        <div class="shots">
          <figure>
            <img src="failure.png" alt="Before screenshot showing the failing UI state" />
            <figcaption>Before: failure.png</figcaption>
          </figure>
          <figure>
            <img src="success.png" alt="After screenshot showing the verified UI state" />
            <figcaption>After: success.png</figcaption>
          </figure>
        </div>
      </article>

      <article class="card">
        <h2>User Workflow</h2>
        <ol class="list timeline">
          ${caseFile.repro.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("\n")}
        </ol>
      </article>

      <article class="card">
        <h2>Before Negative Control</h2>
        <ul class="list">
          <li class="${beforeVerification?.negativeControl?.status === "passing" ? "pass" : "fail"}"><strong>${escapeHtml(beforeVerification?.negativeControl?.status ?? "missing")}</strong>: expected before-state failure</li>
          ${beforeAssertions
            .map(
              (assertion) =>
                `<li class="${assertion.pass ? "pass" : "fail"}"><strong>${escapeHtml(assertion.pass ? "pass" : "fail")}</strong>: ${escapeHtml(assertion.name ?? "unnamed assertion")}</li>`,
            )
            .join("\n")}
        </ul>
      </article>

      <article class="card">
        <h2>Verification Assertions</h2>
        <ul class="list">
          ${assertions
            .map(
              (assertion) =>
                `<li class="${assertion.pass ? "pass" : "fail"}"><strong>${escapeHtml(assertion.pass ? "pass" : "fail")}</strong>: ${escapeHtml(assertion.name ?? "unnamed assertion")}</li>`,
            )
            .join("\n")}
        </ul>
      </article>

      <article class="card wide">
        <h2>Source Localization</h2>
        <ul class="list">
          ${topCandidates
            .map(
              (candidate) =>
                `<li><strong>#${escapeHtml(String(candidate.rank ?? "?"))} ${escapeHtml(candidate.relativeFile ?? "unknown")}</strong> <span class="mono">score ${escapeHtml(String(candidate.score ?? "unknown"))}</span><br>${escapeHtml(candidate.reasons?.join(" ") ?? "No reason recorded.")}</li>`,
            )
            .join("\n")}
        </ul>
      </article>

      <article class="card">
        <h2>Gate Details</h2>
        <ul class="list">
          ${Object.entries(gates)
            .map(
              ([gate, passed]) =>
                `<li class="${passed ? "pass" : "fail"}"><strong>${escapeHtml(passed ? "pass" : "fail")}</strong>: ${escapeHtml(gate)}</li>`,
            )
            .join("\n")}
        </ul>
      </article>

      <article class="card">
        <h2>Changed Files</h2>
        <ul class="list">
          ${changedFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("\n")}
        </ul>
      </article>

      <article class="card wide">
        <h2>Reasoning Boundary</h2>
        <ul class="list">
          <li class="pass"><strong>provider</strong>: ${escapeHtml(reasoner?.provider ?? "missing")}</li>
          <li class="${reasoner?.liveModelUsed ? "pass" : "warning"}"><strong>live model used</strong>: ${escapeHtml(reasoner?.liveModelUsed ? "yes" : "no")}</li>
          <li class="${reasoner?.liveModelUsed ? "pass" : "warning"}"><strong>model</strong>: ${escapeHtml(reasoner?.model ?? "n/a")}</li>
          <li class="${reasoner?.liveModelUsed ? "pass" : "warning"}"><strong>request id</strong>: ${escapeHtml(reasoner?.requestId ?? "n/a")}</li>
          <li class="${reasoner?.liveModelUsed ? "pass" : "warning"}"><strong>latency</strong>: ${escapeHtml(typeof reasoner?.latencyMs === "number" ? `${reasoner.latencyMs}ms` : "n/a")}</li>
          <li class="${reasoner?.liveModelUsed ? "pass" : "warning"}"><strong>usage</strong>: ${escapeHtml(`input ${reasoner?.usage?.inputTokens ?? "n/a"} / output ${reasoner?.usage?.outputTokens ?? "n/a"}`)}</li>
          <li class="pass"><strong>intended model boundary</strong>: ${escapeHtml(reasoner?.intendedModelBoundary ?? "missing")}</li>
          <li class="warning"><strong>recorded run note</strong>: ${escapeHtml(reasoner?.recordedRunNote ?? "Missing recorded-run note.")}</li>
          <li><strong>truth boundary</strong>: ${escapeHtml(reasoner?.truthBoundary ?? "Missing truth boundary.")}</li>
        </ul>
      </article>

      ${renderModelAuthorshipCard(modelTrace, modelScorecard, scorecard)}

      ${modelPatch ? `<article class="card wide">
        <h2>Model-Authored Patch</h2>
        <p>This diff was authored by Claude Code (claude-opus-4-7) inside the target repository. The same deterministic verifier evaluated it against the same gates as the fixture patch above.</p>
        <pre>${escapeHtml(modelPatch)}</pre>
      </article>` : ""}

      ${modelTrace ? renderAgentTimelineCard(modelTrace) : ""}

      <article class="card wide">
        <h2>Recorded Run Environment</h2>
        <p>This section reports the machine that produced this recorded run. It does not validate the reviewer's current machine.</p>
        <ul class="list">
          ${doctorChecks
            .map(
              (check) =>
                `<li class="${statusClassFor(check.status)}"><strong>${escapeHtml(check.status ?? "unknown")}</strong>: ${escapeHtml(check.name ?? "unknown check")}<br><span class="mono">${escapeHtml(check.detail ?? "No detail recorded.")}</span>${check.remedy ? `<br>${escapeHtml(check.remedy)}` : ""}</li>`,
            )
            .join("\n")}
        </ul>
      </article>

      <article class="card wide">
        <h2>Run Timeline</h2>
        <ul class="list timeline">
          ${(run?.phases ?? [])
            .map(
              (phase) =>
                `<li class="${statusClassFor(phase.status)}"><strong>${escapeHtml(phase.status ?? "unknown")}</strong>: ${escapeHtml(phase.name ?? "unknown phase")} <span class="mono">${escapeHtml(formatDuration(phase.durationMs))}</span></li>`,
            )
            .join("\n")}
        </ul>
      </article>

      <article class="card wide">
        <h2>Repair Hypothesis</h2>
        <pre>${escapeHtml(hypothesis || "Missing hypothesis.md")}</pre>
      </article>

      <article class="card wide">
        <h2>Reasoner Artifact</h2>
        <pre>${escapeHtml(reasonerReport || "Missing reasoner.md")}</pre>
      </article>

      <article class="card wide">
        <h2>Evidence Integrity</h2>
        <pre>${escapeHtml(evidenceReport || "Missing evidence-manifest.md")}</pre>
      </article>

      <article class="card">
        <h2>Reasoner Evidence</h2>
        <ul class="list">
          ${evidenceReferences.map((reference) => `<li><code>${escapeHtml(reference)}</code></li>`).join("\n")}
        </ul>
      </article>

      <article class="card">
        <h2>Verification Plan</h2>
        <ul class="list">
          ${(reasoner?.diagnosis?.verificationPlan ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}
        </ul>
      </article>

      <article class="card wide">
        <h2>Patch Diff</h2>
        <pre>${escapeHtml(patch || "Missing patch.diff")}</pre>
      </article>

      <article class="card wide">
        <h2>Raw Audit Links</h2>
        <div class="links">
          ${[
            ["PR report", "PR.md"],
            ["Scorecard", "scorecard.json"],
            ["Before verification", "before-verify.json"],
            ["Doctor", "doctor.json"],
            ["Reasoner JSON", "reasoner.json"],
            ["Reasoner report", "reasoner.md"],
            ["Evidence manifest JSON", "evidence-manifest.json"],
            ["Evidence manifest", "evidence-manifest.md"],
            ["Redaction report", "redaction-report.json"],
            ["GitHub check summary", "github-check.md"],
            ["Hypothesis", "hypothesis.md"],
            ["Candidates", "candidates.json"],
            ["Verification", "verify.json"],
            ["Run timeline", "run.json"],
            ["Patch", "patch.diff"],
            ["Trace", "trace.zip"],
            ["Console", "console.ndjson"],
            ["Network", "network.ndjson"],
            ["AX tree", "ax-tree.json"],
            ["DOM snapshot", "dom-snapshot.json"],
            ...(modelTrace ? [
              ["Model agent trace JSON", "model-agent-trace.json"],
              ["Model agent transcript", "model-agent-trace.md"],
            ] as Array<[string, string]> : []),
            ...(modelPatch ? [
              ["Model patch", "model-patch.diff"],
              ["Model verification", "model-verify.json"],
              ["Model after screenshot", "model-patch.png"],
              ["Model scorecard", "model-scorecard.json"],
            ] as Array<[string, string]> : []),
          ]
            .map(([label, href]) => `<a href="${href}">${escapeHtml(label)}</a>`)
            .join("\n")}
        </div>
      </article>
    </section>
  </main>
</body>
</html>
`;
}

function renderMetric(value: string, detail: string, label: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function renderModelAuthorshipCard(
  trace: ModelAgentTrace | undefined,
  modelScorecard: ModelScorecard | undefined,
  fixtureScorecard: Scorecard | undefined,
): string {
  if (!trace || trace.status === "no-api-key") {
    return "";
  }
  const liveModelUsed = trace.liveModelUsed === true;
  const turns = typeof trace.totalTurns === "number" ? trace.totalTurns : 0;
  const tools = typeof trace.totalToolCalls === "number" ? trace.totalToolCalls : 0;
  const filesEdited = (trace.filesEdited ?? []).length;
  const filesRead = (trace.filesRead ?? []).length;
  const cost = typeof trace.totalCostUsd === "number" ? `$${trace.totalCostUsd.toFixed(4)}` : "n/a";
  const durationSeconds = typeof trace.durationMs === "number" ? `${(trace.durationMs / 1000).toFixed(1)}s` : "n/a";
  const fixtureStatus = fixtureScorecard?.status ?? "missing";
  const fixtureScore = typeof fixtureScorecard?.score === "number" ? fixtureScorecard.score : "n/a";
  const modelStatus = modelScorecard?.status ?? "missing";
  const modelScore = typeof modelScorecard?.score === "number" ? modelScorecard.score : "n/a";

  return `<article class="card wide">
        <h2>Model Authorship — Claude Code Agent Loop</h2>
        <p>Opus 4.7 ran inside the target repository and authored a candidate patch using Read, Glob, Grep, and Edit tools. The deterministic verifier evaluated this patch against the same gates as the fixture above.</p>
        <div class="metrics" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px; margin-top: 14px;">
          ${renderMetric(String(turns), "agent turns", "Turns")}
          ${renderMetric(String(tools), "tool calls", "Tool Calls")}
          ${renderMetric(String(filesRead), "files read", "Files Read")}
          ${renderMetric(String(filesEdited), "files edited", "Files Edited")}
          ${renderMetric(durationSeconds, "wall clock", "Duration")}
          ${renderMetric(cost, "client estimate", "Cost")}
        </div>
        <div style="margin-top: 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px;">
          <div class="${fixtureStatus === "passing" ? "pass" : "fail"}" style="padding: 14px; border: 1px solid currentColor;">
            <strong>Fixture Patch</strong>
            <div style="font-size: 22px;">${escapeHtml(String(fixtureStatus))} (${escapeHtml(String(fixtureScore))})</div>
            <div class="mono">human-authored, golden baseline</div>
          </div>
          <div class="${modelStatus === "passing" ? "pass" : modelStatus === "skipped" ? "warning" : "fail"}" style="padding: 14px; border: 1px solid currentColor;">
            <strong>Model Patch</strong>
            <div style="font-size: 22px;">${escapeHtml(String(modelStatus))} (${escapeHtml(String(modelScore))})</div>
            <div class="mono">claude-opus-4-7 via Claude Code SDK</div>
          </div>
        </div>
        <ul class="list" style="margin-top: 18px;">
          <li class="pass"><strong>provider</strong>: ${escapeHtml(trace.provider ?? "missing")}</li>
          <li class="${liveModelUsed ? "pass" : "warning"}"><strong>live model used</strong>: ${escapeHtml(liveModelUsed ? "yes" : "no")}</li>
          <li class="${liveModelUsed ? "pass" : "warning"}"><strong>model</strong>: ${escapeHtml(trace.model ?? "n/a")}</li>
          <li class="${liveModelUsed ? "pass" : "warning"}"><strong>session id</strong>: ${escapeHtml(trace.sessionId ?? "n/a")}</li>
          <li><strong>loaded tools</strong>: ${escapeHtml((trace.loadedTools ?? []).join(", ") || "n/a")}</li>
          <li><strong>result subtype</strong>: ${escapeHtml(trace.resultSubtype ?? "n/a")}</li>
          <li><strong>tokens</strong>: ${escapeHtml(`input ${trace.inputTokens ?? "n/a"} / output ${trace.outputTokens ?? "n/a"} / cache-read ${trace.cacheReadInputTokens ?? "n/a"}`)}</li>
          <li><strong>truth boundary</strong>: ${escapeHtml(trace.truthBoundary ?? "Models propose. Verifiers decide.")}</li>
          <li class="warning"><strong>recorded run note</strong>: ${escapeHtml(trace.recordedRunNote ?? "")}</li>
        </ul>
        ${(trace.errors && trace.errors.length > 0)
          ? `<ul class="list">${trace.errors.map((error) => `<li class="fail">${escapeHtml(error)}</li>`).join("\n")}</ul>`
          : ""}
        ${(trace.permissionDenials && trace.permissionDenials.length > 0)
          ? `<p>Permission denials: ${trace.permissionDenials.map((denial) => escapeHtml(String(denial.toolName ?? "unknown"))).join(", ")}</p>`
          : ""}
      </article>`;
}

function renderAgentTimelineCard(trace: ModelAgentTrace): string {
  const turns = trace.turns ?? [];
  if (turns.length === 0) return "";
  const items = turns
    .map((turn) => {
      const calls = (turn.toolCalls ?? [])
        .map((call) => {
          const filePath = typeof call.input?.["file_path"] === "string" ? String(call.input["file_path"]).replace(/\\/g, "/") : undefined;
          const cmd = typeof call.input?.["command"] === "string" ? String(call.input["command"]) : undefined;
          const pattern = typeof call.input?.["pattern"] === "string" ? String(call.input["pattern"]) : undefined;
          const arg = filePath ?? cmd ?? pattern ?? "";
          const truncated = arg.length > 160 ? `${arg.slice(0, 157)}...` : arg;
          return `<li class="${call.isError ? "fail" : "pass"}"><strong>${escapeHtml(call.name ?? "unknown")}</strong>${truncated ? `: <code>${escapeHtml(truncated)}</code>` : ""}</li>`;
        })
        .join("\n");
      const text = (turn.textBlocks ?? []).join("\n\n").trim();
      const truncatedText = text.length > 600 ? `${text.slice(0, 600)}...` : text;
      return `<li>
        <strong>Turn ${escapeHtml(String(turn.turnIndex ?? "n/a"))}</strong>
        ${truncatedText ? `<p>${escapeHtml(truncatedText)}</p>` : ""}
        ${calls ? `<ul class="list">${calls}</ul>` : ""}
      </li>`;
    })
    .join("\n");
  return `<article class="card wide">
        <h2>Agent Timeline</h2>
        <p>Each turn shows what Opus 4.7 said and what tools it called. Tool calls are the substance: <code>Read</code>, <code>Glob</code>, <code>Grep</code> for understanding; <code>Edit</code> for the candidate patch.</p>
        <ol class="list timeline">
          ${items}
        </ol>
      </article>`;
}

function percent(value: number | undefined): string {
  if (typeof value !== "number") {
    return "missing";
  }

  return `${Math.round(value * 100)}%`;
}

function yesNo(value: boolean | undefined): string {
  if (typeof value !== "boolean") {
    return "missing";
  }

  return value ? "yes" : "no";
}

function statusClassFor(status: string | undefined): string {
  if (status === "passing" || status === "pass") {
    return "pass";
  }

  if (status === "warning" || status === "running" || status === "pending") {
    return "warning";
  }

  return "fail";
}

function formatDuration(value: number | undefined): string {
  if (typeof value !== "number") {
    return "missing";
  }

  if (value < 1000) {
    return `${value}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
