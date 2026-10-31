import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

type Scorecard = {
  status?: string;
  score?: number;
  metrics?: {
    artifactCompletenessRatio?: number;
    verificationPassRate?: number;
    patchTouchesTopCandidate?: boolean;
    negativeControlPassed?: boolean;
    reasonerProvider?: string;
    doctorStatus?: string;
    runStatus?: string;
    cleanupSucceeded?: boolean;
    totalRunDurationMs?: number;
    topCandidate?: string;
  };
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
  }>;
};

type ReasonerArtifact = {
  provider?: string;
  liveModelUsed?: boolean;
  model?: string;
  requestId?: string;
  recordedRunNote?: string;
  truthBoundary?: string;
};

type PlannedCaseArtifact = {
  status?: string;
  reason?: string;
  nextProofStep?: string;
};

export async function generateDemoHub(caseFile: CaseFile, outPath = "artifacts/index.html"): Promise<string> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const scorecard = await readJson<Scorecard>(manifest.files.scorecard);
  const run = await readJson<RunTimeline>(manifest.files.run);
  const doctor = await readJson<DoctorReport>(manifest.files.doctor);
  const reasoner = await readJson<ReasonerArtifact>(manifest.files.reasoner);
  const modelTrace = await readJson<HubModelTrace>(manifest.files.modelTrace);
  const modelScorecard = await readJson<HubModelScorecard>(manifest.files.modelScorecard);
  const onboardingScorecard = await readJson<Scorecard>("./artifacts/crwa-mobile-onboarding-dialog/scorecard.json");
  const onboardingModelTrace = await readJson<HubModelTrace>("./artifacts/crwa-mobile-onboarding-dialog/model-agent-trace.json");
  const onboardingModelScorecard = await readJson<HubModelScorecard>("./artifacts/crwa-mobile-onboarding-dialog/model-scorecard.json");
  const onboardingPlanned = await readJson<PlannedCaseArtifact>("./artifacts/crwa-mobile-onboarding-dialog/planned.json");
  const overlapPlanned = await readJson<PlannedCaseArtifact>("./artifacts/crwa-mobile-modal-overlap/planned.json");
  const resolvedOutPath = resolve(outPath);

  await mkdir(dirname(resolvedOutPath), { recursive: true });
  await writeFile(
    resolvedOutPath,
    renderDemoHub({
      caseFile,
      scorecard,
      run,
      doctor,
      reasoner,
      modelTrace,
      modelScorecard,
      onboardingScorecard,
      onboardingModelTrace,
      onboardingModelScorecard,
      onboardingPlanned,
      overlapPlanned,
    }),
    "utf8",
  );

  return resolvedOutPath;
}

type HubModelTrace = {
  status?: string;
  liveModelUsed?: boolean;
  provider?: string;
  model?: string;
  totalTurns?: number;
  totalToolCalls?: number;
  filesEdited?: string[];
  filesRead?: string[];
  durationMs?: number;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  patchByteLength?: number;
};

type HubModelScorecard = {
  status?: string;
  score?: number;
  source?: string;
  gates?: {
    patchProvided?: boolean;
    patchApplies?: boolean;
    verificationPassing?: boolean;
    patchRelevant?: boolean;
  };
};

function renderDemoHub({
  caseFile,
  scorecard,
  run,
  doctor,
  reasoner,
  modelTrace,
  modelScorecard,
  onboardingScorecard,
  onboardingModelTrace,
  onboardingModelScorecard,
  onboardingPlanned,
  overlapPlanned,
}: {
  caseFile: CaseFile;
  scorecard?: Scorecard;
  run?: RunTimeline;
  doctor?: DoctorReport;
  reasoner?: ReasonerArtifact;
  modelTrace?: HubModelTrace;
  modelScorecard?: HubModelScorecard;
  onboardingScorecard?: Scorecard;
  onboardingModelTrace?: HubModelTrace;
  onboardingModelScorecard?: HubModelScorecard;
  onboardingPlanned?: PlannedCaseArtifact;
  overlapPlanned?: PlannedCaseArtifact;
}): string {
  const artifactSubpath = caseFile.artifacts.directory.replace(/^\.?\/?artifacts\//, "");
  const dossierPath = `${artifactSubpath}/index.html`;
  const failurePath = `${artifactSubpath}/failure.png`;
  const successPath = `${artifactSubpath}/success.png`;
  const evidenceManifestPath = `${artifactSubpath}/evidence-manifest.md`;
  const runDuration = scorecard?.metrics?.totalRunDurationMs ?? run?.durationMs;
  const provenTopCandidate = scorecard?.metrics?.topCandidate ?? "src/components/TransactionDateRangeFilter.tsx";
  const compactDoctor = summarizeDoctorChecks(doctor);
  const onboardingStatus =
    onboardingScorecard?.status === "passing"
      ? "verified"
      : onboardingPlanned?.status === "planned"
        ? "planned"
        : "planned";
  const verifiedCaseCount = 1 + (onboardingScorecard?.status === "passing" ? 1 : 0);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Forensic Repo Surgeon Demo Cockpit</title>
  <style>
    :root {
      --ink: #f7efe0;
      --subtle: rgba(247, 239, 224, 0.68);
      --coal: #11120f;
      --coal-2: #1d1b16;
      --paper: #ead9b4;
      --brass: #d69d42;
      --signal: #7ee0a0;
      --danger: #e76551;
      --blue: #7db7ce;
      --line: rgba(247, 239, 224, 0.18);
      --shadow: 0 32px 90px rgba(0, 0, 0, 0.38);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      overflow-wrap: anywhere;
      color: var(--ink);
      background:
        radial-gradient(circle at 12% 8%, rgba(214, 157, 66, 0.18), transparent 28%),
        radial-gradient(circle at 86% 18%, rgba(126, 224, 160, 0.12), transparent 28%),
        linear-gradient(115deg, rgba(125, 183, 206, 0.08) 0 1px, transparent 1px 32px),
        var(--coal);
      font-family: Georgia, Cambria, "Times New Roman", serif;
    }

    a {
      color: inherit;
    }

    .shell {
      width: min(1220px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 58px;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 24px;
      min-height: 520px;
      padding: 30px;
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(29, 27, 22, 0.96), rgba(17, 18, 15, 0.94));
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }

    .hero::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, transparent 0 48%, rgba(214, 157, 66, 0.08) 48% 49%, transparent 49%),
        repeating-linear-gradient(0deg, transparent 0 30px, rgba(247, 239, 224, 0.035) 30px 31px);
      pointer-events: none;
    }

    .hero > * {
      position: relative;
      z-index: 1;
    }

    .eyebrow,
    .mono,
    .button,
    .tag,
    .metric span,
    code {
      font-family: "Cascadia Code", Consolas, monospace;
    }

    .eyebrow {
      margin: 0 0 14px;
      color: var(--brass);
      font-size: 12px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }

    h1 {
      max-width: 780px;
      margin: 0;
      font-size: clamp(50px, 8vw, 116px);
      line-height: 0.82;
      letter-spacing: -0.07em;
    }

    .thesis {
      max-width: 720px;
      margin: 22px 0 0;
      color: var(--subtle);
      font-size: 22px;
      line-height: 1.42;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 28px;
    }

    .button {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 13px 16px;
      border: 1px solid rgba(247, 239, 224, 0.28);
      background: var(--paper);
      color: #15130e;
      text-decoration: none;
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      transition: transform 180ms ease, border-color 180ms ease;
    }

    .button.secondary {
      background: transparent;
      color: var(--ink);
    }

    .button:hover {
      transform: translateY(-2px);
      border-color: var(--brass);
    }

    .status-tower {
      align-self: stretch;
      display: grid;
      gap: 12px;
    }

    .metric {
      min-height: 112px;
      padding: 18px;
      border: 1px solid var(--line);
      background: rgba(247, 239, 224, 0.06);
      backdrop-filter: blur(8px);
    }

    .metric span {
      display: block;
      color: var(--subtle);
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .metric strong {
      display: block;
      margin-top: 16px;
      color: var(--signal);
      font-size: 38px;
      letter-spacing: -0.05em;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 18px;
      margin-top: 18px;
    }

    .panel {
      grid-column: span 6;
      padding: 24px;
      border: 1px solid var(--line);
      background: rgba(29, 27, 22, 0.82);
      box-shadow: 0 18px 55px rgba(0, 0, 0, 0.22);
    }

    .panel.wide {
      grid-column: span 12;
    }

    .panel.third {
      grid-column: span 4;
    }

    h2 {
      margin: 0 0 14px;
      color: var(--paper);
      font-size: 31px;
      letter-spacing: -0.04em;
    }

    p {
      color: var(--subtle);
      line-height: 1.55;
    }

    .demo-frame {
      display: grid;
      grid-template-columns: 1fr 0.86fr;
      gap: 18px;
      align-items: start;
    }

    .shot-strip {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .mini-shot {
      min-width: 0;
    }

    .mini-shot img {
      width: 100%;
      height: 420px;
      object-fit: contain;
      border: 1px solid rgba(247, 239, 224, 0.28);
      box-shadow: 0 28px 70px rgba(0, 0, 0, 0.34);
      background: #090908;
    }

    .mini-shot figcaption {
      margin-top: 8px;
      color: var(--subtle);
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .command {
      margin: 0;
      padding: 18px;
      overflow: auto;
      border: 1px solid rgba(126, 224, 160, 0.26);
      background: #090908;
      color: var(--signal);
      line-height: 1.7;
      white-space: pre-wrap;
    }

    .cards,
    .rail {
      display: grid;
      gap: 12px;
    }

    .case-card,
    .step {
      padding: 16px;
      border: 1px solid var(--line);
      background: rgba(247, 239, 224, 0.045);
    }

    .case-card.proven {
      border-color: rgba(126, 224, 160, 0.58);
    }

    .case-card.next {
      border-color: rgba(214, 157, 66, 0.5);
    }

    .case-card.later {
      border-style: dashed;
    }

    .tag {
      display: inline-flex;
      margin-bottom: 10px;
      color: var(--brass);
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .case-card strong,
    .step strong {
      display: block;
      margin-bottom: 6px;
      font-size: 20px;
      letter-spacing: -0.03em;
    }

    .pipeline {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
    }

    .pipe {
      min-height: 122px;
      padding: 14px;
      border: 1px solid var(--line);
      background: rgba(247, 239, 224, 0.05);
    }

    .pipe b {
      display: block;
      margin-bottom: 10px;
      color: var(--paper);
    }

    .pipe span {
      color: var(--subtle);
      font-size: 14px;
      line-height: 1.35;
    }

    ul {
      margin: 0;
      padding-left: 18px;
      color: var(--subtle);
      line-height: 1.65;
    }

    .truth {
      border-color: rgba(231, 101, 81, 0.42);
      background: linear-gradient(135deg, rgba(231, 101, 81, 0.08), rgba(247, 239, 224, 0.035));
    }

    @media (max-width: 960px) {
      .hero,
      .demo-frame,
      .pipeline {
        grid-template-columns: 1fr;
      }

      .panel,
      .panel.third {
        grid-column: span 12;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Static review first / optional rerun second</p>
        <h1>Agents create diffs. Surgeon creates proof.</h1>
        <p class="thesis">Forensic Repo Surgeon turns a reproducible frontend bug report into a reviewer-trustworthy repair package: before evidence, a deterministic negative control, source localization, patch, after verification, run timeline, and a scorecard your CI can read.</p>
        <div class="actions">
          <a class="button" href="${escapeHtml(dossierPath)}">Open validation dossier</a>
          <a class="button secondary" href="${escapeHtml(artifactSubpath)}/PR.md">Open PR report</a>
          <a class="button secondary" href="${escapeHtml(evidenceManifestPath)}">Open evidence manifest</a>
        </div>
      </div>
      <aside class="status-tower">
        ${renderMetric("fixture scorecard", String(scorecard?.score ?? "??"), scorecard?.status ?? "missing")}
        ${modelTrace ? renderMetric("model scorecard", String(modelScorecard?.score ?? "??"), modelScorecard?.status ?? "missing") : renderMetric("doctor", doctor?.status ?? "missing", "recorded run env")}
        ${renderMetric("reasoner", reasoner?.provider ?? "missing", reasoner?.liveModelUsed ? "live model run" : "recorded fallback")}
        ${modelTrace ? renderMetric("agent loop", `${modelTrace.totalTurns ?? 0} turns`, modelTrace.liveModelUsed ? "claude-opus-4-7 live" : "skipped") : renderMetric("runtime", formatDuration(runDuration), "golden run")}
        ${renderMetric("target", "CRWA", "real React app")}
      </aside>
    </section>

    <section class="grid">
      <article class="panel wide">
        <div class="demo-frame">
          <div>
            <h2>Review First, Rerun Second</h2>
            <p>Start with static artifacts. Only run commands if you want to regenerate the proof bundle on a compatible machine.</p>
            <pre class="command">Static review
1. Open the validation dossier
2. Read PR.md, reasoner.md, and evidence-manifest.md
3. Confirm scorecard.json, run.json, and doctor.json

Optional rerun
pnpm install
pnpm demo</pre>
          </div>
          <div class="shot-strip" aria-label="Current before and after evidence">
            <figure class="mini-shot">
              <img src="${escapeHtml(failurePath)}" alt="Before evidence screenshot" />
              <figcaption>Before evidence</figcaption>
            </figure>
            <figure class="mini-shot">
              <img src="${escapeHtml(successPath)}" alt="After verification screenshot" />
              <figcaption>After verification</figcaption>
            </figure>
          </div>
        </div>
      </article>

      <article class="panel third">
        <h2>Real User</h2>
        <p>A frontend engineer receives a bug report with a screenshot: the UI is visibly wrong, but the owner file and safe fix are not obvious.</p>
        <ul>
          <li>Reproduce the state in browser</li>
          <li>Map UI evidence back to source</li>
          <li>Patch only the relevant component</li>
          <li>Attach before/after proof to review</li>
        </ul>
      </article>

      <article class="panel third">
        <h2>Proven Now</h2>
        <p>The current locked case is a real authenticated mobile drawer bug in <code>cypress-realworld-app</code>.</p>
        <ul>
          <li>Top candidate: <code>${escapeHtml(provenTopCandidate)}</code></li>
          <li>Verification pass rate: ${escapeHtml(percent(scorecard?.metrics?.verificationPassRate))}</li>
          <li>Before negative control: ${escapeHtml(scorecard?.metrics?.negativeControlPassed ? "passed" : "missing")}</li>
          <li>Artifact completeness: ${escapeHtml(percent(scorecard?.metrics?.artifactCompletenessRatio))}</li>
          <li>Reasoner provider: ${escapeHtml(scorecard?.metrics?.reasonerProvider ?? "missing")} (${escapeHtml(reasoner?.liveModelUsed ? "live model" : "recorded fallback")})</li>
          <li>Reasoner model: ${escapeHtml(reasoner?.model ?? "n/a")}</li>
          <li>Reasoner request id: ${escapeHtml(reasoner?.requestId ?? "n/a")}</li>
          <li>Verified same-target cases: ${escapeHtml(String(verifiedCaseCount))}</li>
          <li>Cleanup: ${escapeHtml(scorecard?.metrics?.cleanupSucceeded ? "passed" : "missing")}</li>
          <li>Score is scoped to this case and these proof gates</li>
        </ul>
      </article>

      ${modelTrace ? renderModelAuthorshipPanel(modelTrace, modelScorecard, scorecard, artifactSubpath, "Date Range Drawer") : ""}
      ${onboardingModelTrace ? renderModelAuthorshipPanel(onboardingModelTrace, onboardingModelScorecard, onboardingScorecard, "crwa-mobile-onboarding-dialog", "Onboarding Dialog") : ""}

      <article class="panel third truth">
        <h2>Honest Scope</h2>
        <p>One case is not enough to claim generality. Two same-target cases are enough to show the architecture expands without dropping the proof boundary.</p>
        <ul>
          <li>Do not claim arbitrary repo support</li>
          <li>Do not trust screenshots without assertions</li>
          <li>Disclose the recorded reasoner provider truthfully</li>
          <li>Models advise, verifiers decide</li>
          <li>Do not add agents before phase boundaries</li>
          <li>Do add cases through contracts and adapters</li>
        </ul>
      </article>

      <article class="panel wide">
        <h2>Capability Pipeline</h2>
        <div class="pipeline">
          ${renderPipe("1", "Case", "Route, viewport, auth, repro steps, expected proof.")}
          ${renderPipe("2", "Reproduce", "Playwright reaches the failing browser state.")}
          ${renderPipe("3", "Fail First", "Before-state assertions record the expected failure.")}
          ${renderPipe("4", "Localize", "Rank files with inspectable evidence.")}
          ${renderPipe("5", "Repair", "Apply a focused patch to the candidate file.")}
          ${renderPipe("6", "Verify", "Rerun assertions and score proof gates.")}
        </div>
      </article>

      <article class="panel">
        <h2>Expansion Without Breaking</h2>
        <div class="rail">
          ${renderStep("Case contracts", "Every new demo starts as a case file with target, workflow, viewport, auth, evidence, and assertions.")}
          ${renderStep("Target adapters", "Repo-specific start, stop, patch, and health behavior stays behind adapters.")}
          ${renderStep("Assertion registry", "New bug classes add reusable checks such as inside viewport, no overlap, visible, and no console regressions.")}
          ${renderStep("Reasoner phase", "The reasoner explains evidence and proposes a fix, but deterministic proof gates still decide acceptance.")}
          ${renderStep("Scorecard gate", "A case is not accepted unless artifacts, negative control, after verification, doctor checks, run status, and cleanup all pass.")}
        </div>
      </article>

      <article class="panel">
        <h2>Case Catalog</h2>
        <div class="cards">
          <div class="case-card proven">
            <span class="tag">verified</span>
            <strong>Authenticated mobile date-range drawer</strong>
            <p>Viewport clipping and scroll containment in a real React/MUI app.</p>
          </div>
          <div class="case-card ${onboardingStatus === "verified" ? "proven" : "next"}">
            <span class="tag">${escapeHtml(onboardingStatus)}</span>
            <strong>New-user mobile onboarding dialog overflow</strong>
            <p>${escapeHtml(
              onboardingStatus === "verified"
                ? "Second same-target case passed the same artifact, verification, doctor, and scorecard gates."
                : onboardingPlanned?.reason ?? "Fresh-user signup plus mobile onboarding assertions exercise a second visible UI failure in the same target app.",
            )}</p>
          </div>
          <div class="case-card next">
            <span class="tag">planned</span>
            <strong>Mobile modal or nav overlap</strong>
            <p>${escapeHtml(
              overlapPlanned?.reason ?? "Reusable no-overlap assertion, same auth/target adapter, lower setup risk.",
            )}</p>
          </div>
          <div class="case-card later">
            <span class="tag">later</span>
            <strong>Second React repo</strong>
            <p>Only after assertion registry and target adapter seams are stable.</p>
          </div>
        </div>
      </article>

      <article class="panel wide">
        <h2>Models Advise, Verifiers Decide</h2>
        <p>${escapeHtml(
          reasoner?.truthBoundary ??
            "A visible reasoning phase can interpret evidence, explain likely root cause, and propose a patch hypothesis, but deterministic verification and scorecard gates decide whether the repair is accepted.",
        )}</p>
        <p>${escapeHtml(
          reasoner?.recordedRunNote ??
            "The recorded provider shown above is the provider that actually produced the reasoner artifact for this run.",
        )}</p>
      </article>

      <article class="panel wide">
        <h2>Recorded Run Environment</h2>
        <p>These checks describe the machine that produced this artifact bundle. They do not inspect the reviewer's current machine.</p>
        <ul>
          ${compactDoctor.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}
        </ul>
      </article>
    </section>
  </main>
</body>
</html>
`;
}

function renderMetric(label: string, value: string, detail: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function renderModelAuthorshipPanel(
  trace: HubModelTrace,
  modelScorecard: HubModelScorecard | undefined,
  fixtureScorecard: Scorecard | undefined,
  artifactSubpath: string,
  caseLabel: string,
): string {
  if (!trace || trace.status === "no-api-key") return "";
  const fixtureScore = typeof fixtureScorecard?.score === "number" ? fixtureScorecard.score : "??";
  const fixtureStatus = fixtureScorecard?.status ?? "missing";
  const modelStatus = modelScorecard?.status ?? "skipped";
  const modelScore = typeof modelScorecard?.score === "number" ? modelScorecard.score : "??";
  const modelTracePath = `${artifactSubpath}/model-agent-trace.json`;
  const modelPatchPath = `${artifactSubpath}/model-patch.diff`;
  const modelScorecardPath = `${artifactSubpath}/model-scorecard.json`;
  const cost = typeof trace.totalCostUsd === "number" ? `$${trace.totalCostUsd.toFixed(4)}` : "n/a";
  const duration = formatDuration(trace.durationMs);

  return `<article class="panel wide">
        <h2>Model Authorship — ${escapeHtml(caseLabel)}</h2>
        <p>Opus 4.7 ran inside the target repository through a Claude Code agent loop and authored a candidate patch using <code>Read</code>, <code>Glob</code>, <code>Grep</code>, and <code>Edit</code> tools. The deterministic verifier evaluated this patch against the same gates as the fixture patch.</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 12px;">
          <div class="card-status">
            <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;">Fixture Patch</div>
            <div style="font-size: 28px; font-weight: bold;">${escapeHtml(String(fixtureStatus))}</div>
            <div style="font-size: 13px;">score ${escapeHtml(String(fixtureScore))} / human-authored baseline</div>
          </div>
          <div class="card-status">
            <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;">Model Patch</div>
            <div style="font-size: 28px; font-weight: bold;">${escapeHtml(String(modelStatus))}</div>
            <div style="font-size: 13px;">score ${escapeHtml(String(modelScore))} / claude-opus-4-7 via Claude Code SDK</div>
          </div>
        </div>
        <ul style="margin-top: 14px; padding-left: 20px;">
          <li>Agent turns: ${escapeHtml(String(trace.totalTurns ?? 0))}</li>
          <li>Tool calls: ${escapeHtml(String(trace.totalToolCalls ?? 0))}</li>
          <li>Files read: ${escapeHtml(String((trace.filesRead ?? []).length))} / Files edited: ${escapeHtml(String((trace.filesEdited ?? []).length))}</li>
          <li>Tokens: input ${escapeHtml(String(trace.inputTokens ?? "n/a"))} / output ${escapeHtml(String(trace.outputTokens ?? "n/a"))}</li>
          <li>Wall clock: ${escapeHtml(duration)} / cost: ${escapeHtml(cost)}</li>
          <li>Provider: ${escapeHtml(trace.provider ?? "n/a")} / model: ${escapeHtml(trace.model ?? "n/a")}</li>
        </ul>
        <div class="actions" style="margin-top: 12px;">
          <a class="button secondary" href="${escapeHtml(modelTracePath)}">Agent transcript JSON</a>
          <a class="button secondary" href="${escapeHtml(modelPatchPath)}">Model patch diff</a>
          <a class="button secondary" href="${escapeHtml(modelScorecardPath)}">Model scorecard</a>
        </div>
      </article>`;
}

function renderPipe(number: string, label: string, detail: string): string {
  return `<div class="pipe"><b>${escapeHtml(number)}. ${escapeHtml(label)}</b><span>${escapeHtml(detail)}</span></div>`;
}

function renderStep(label: string, detail: string): string {
  return `<div class="step"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(detail)}</p></div>`;
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

function percent(value: number | undefined): string {
  if (typeof value !== "number") {
    return "missing";
  }

  return `${Math.round(value * 100)}%`;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  catch {
    return undefined;
  }
}

function summarizeDoctorChecks(doctor: DoctorReport | undefined): string[] {
  if (!doctor?.checks?.length) {
    return ["Doctor artifact is missing."];
  }

  return doctor.checks
    .filter((check) =>
      ["demo target repo", "demo ports", "workspace drive", "target drive", "target patch state"].includes(
        check.name ?? "",
      ),
    )
    .map((check) => `${check.name}: ${check.detail}`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
