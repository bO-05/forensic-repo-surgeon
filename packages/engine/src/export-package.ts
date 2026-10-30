import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { generateCaseEvidenceManifest, generateExportIntegrityManifest } from "./integrity.ts";
import { sanitizePublicDirectory } from "./public-export.ts";
import { generateArtifactViewer } from "./viewer.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

const DEFAULT_EXPORT_DIR = "dist/demo-package";

const DOCS_TO_EXPORT = [
  "docs/README.md",
  "docs/quickstart.md",
  "docs/architecture.md",
  "docs/positioning.md",
  "docs/roadmap.md",
  "docs/public-export.md",
] as const;

export async function exportDemoPackage(caseFile: CaseFile, outDir = DEFAULT_EXPORT_DIR): Promise<string> {
  const resolvedOutDir = resolve(outDir);
  const manifest = createPlannedArtifactManifest({ ...caseFile, artifacts: { ...caseFile.artifacts, directory: `artifacts/${caseFile.id}` } });
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const sourceDirectories = [artifactDirectory, ...["artifacts", "evals", "docs"].map(path => resolve(path))];
  if (process.cwd() === resolvedOutDir || process.cwd().startsWith(`${resolvedOutDir}${sep}`) ||
      sourceDirectories.some(path => path === resolvedOutDir || path.startsWith(`${resolvedOutDir}${sep}`) || resolvedOutDir.startsWith(`${path}${sep}`))) {
    throw new Error("Public export must be separate from the workspace and operational artifacts.");
  }

  await rm(resolvedOutDir, { recursive: true, force: true });
  await mkdir(resolvedOutDir, { recursive: true });
  await copyIfExists("README.md", resolve(resolvedOutDir, "README.source.md"));
  await copyIfExists("artifacts/index.html", resolve(resolvedOutDir, "artifacts/index.html"));
  await copyIfExists("artifacts/demo-cockpit-preview.png", resolve(resolvedOutDir, "artifacts/demo-cockpit-preview.png"));
  await copyIfExists(artifactDirectory, resolve(resolvedOutDir, "artifacts", caseFile.id));
  await copyIfExists("artifacts/crwa-mobile-onboarding-dialog", resolve(resolvedOutDir, "artifacts", "crwa-mobile-onboarding-dialog"));
  await copyIfExists("artifacts/crwa-mobile-modal-overlap", resolve(resolvedOutDir, "artifacts", "crwa-mobile-modal-overlap"));
  await copyIfExists("artifacts/evals", resolve(resolvedOutDir, "artifacts", "evals"));
  await copyIfExists("evals", resolve(resolvedOutDir, "evals"));

  for (const docPath of DOCS_TO_EXPORT) {
    await copyIfExists(docPath, resolve(resolvedOutDir, docPath));
  }

  await writeFile(
    resolve(resolvedOutDir, "README.md"),
    renderPackageReadme(caseFile),
    "utf8",
  );
  const roots = [
    { path: process.cwd(), label: "[workspace]" },
    { path: resolvedOutDir, label: "[public-package]" },
  ];
  await sanitizePublicDirectory(resolvedOutDir, roots);
  const recordedCases = [caseFile];
  const onboardingPath = resolve("cases/cypress-realworld-mobile-onboarding-dialog.case.json");
  if (existsSync(onboardingPath) && caseFile.id !== "crwa-mobile-onboarding-dialog") {
    recordedCases.push(JSON.parse(await readFile(onboardingPath, "utf8")) as CaseFile);
  }
  for (const recorded of recordedCases) {
    const directory = resolve(resolvedOutDir, "artifacts", recorded.id);
    if (!existsSync(resolve(directory, "scorecard.json"))) continue;
    const publicCase = { ...recorded, artifacts: { ...recorded.artifacts, directory } };
    await generateCaseEvidenceManifest(publicCase, { relativeTo: resolvedOutDir });
    // Rebuild the dossier from sanitized inputs rather than patching stale HTML.
    await generateArtifactViewer(publicCase);
  }
  await writeFile(resolve(resolvedOutDir, "artifacts/public-export-notice.json"), `${JSON.stringify({
    policyVersion: "2026-10-30.public-copy",
    exportedAt: new Date().toISOString(),
    recordedEvidence: true,
    newModelOrVerifierRun: false,
    privacyBoundary: "Producer-machine paths and text secrets were sanitized, including archived browser trace text. Operational originals were not modified. Binary screenshots are retained recorded evidence, not a claim of universal data anonymization.",
  }, null, 2)}\n`, "utf8");
  await sanitizePublicDirectory(resolvedOutDir, roots);
  const integrity = await generateExportIntegrityManifest(resolvedOutDir, caseFile);
  await writeFile(
    resolve(resolvedOutDir, "package-manifest.json"),
    `${JSON.stringify(
      {
        caseId: caseFile.id,
        generatedAt: new Date().toISOString(),
        reviewMode: "static-first",
        entrypoints: {
          cockpit: "artifacts/index.html",
          dossier: `artifacts/${caseFile.id}/index.html`,
          prReport: `artifacts/${caseFile.id}/PR.md`,
          scorecard: `artifacts/${caseFile.id}/scorecard.json`,
          beforeVerification: `artifacts/${caseFile.id}/before-verify.json`,
          doctor: `artifacts/${caseFile.id}/doctor.json`,
          reasoner: `artifacts/${caseFile.id}/reasoner.md`,
          evidenceManifest: `artifacts/${caseFile.id}/evidence-manifest.md`,
          redactionReport: `artifacts/${caseFile.id}/redaction-report.json`,
          runTimeline: `artifacts/${caseFile.id}/run.json`,
          githubCheck: `artifacts/${caseFile.id}/github-check.md`,
          modelAgentTrace: `artifacts/${caseFile.id}/model-agent-trace.json`,
          modelAgentTranscript: `artifacts/${caseFile.id}/model-agent-trace.md`,
          modelPatch: `artifacts/${caseFile.id}/model-patch.diff`,
          modelScorecard: `artifacts/${caseFile.id}/model-scorecard.json`,
          modelVerify: `artifacts/${caseFile.id}/model-verify.json`,
          modelScreenshot: `artifacts/${caseFile.id}/model-patch.png`,
          proofEvaluation: "artifacts/evals/proof-evaluation.md",
          benchmarkManifest: "evals/proof-benchmark.json",
          packageIntegrity: "package-integrity.md",
          quickstart: "docs/quickstart.md",
        },
        secondaryCases: {
          onboarding: "artifacts/crwa-mobile-onboarding-dialog/index.html",
          overlapPlanned: "artifacts/crwa-mobile-modal-overlap/planned.json",
        },
        integrity: {
          type: integrity.summary.integrityType,
          signed: integrity.summary.signed,
          note: integrity.summary.note,
          bundleFingerprint: integrity.summary.bundleFingerprint,
          fileCount: integrity.summary.fileCount,
          json: "package-integrity.json",
          markdown: "package-integrity.md",
        },
        recordedRunNotice:
          "Privacy-sanitized recorded evidence, not a new model or verifier run. Producer paths and text secrets were removed, including archived browser trace text; case and package hashes were refreshed. doctor.json describes the recorded producer, not the evaluator's machine.",
        sourceArtifactManifest: manifest.files,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return resolvedOutDir;
}

async function copyIfExists(fromPath: string, toPath: string): Promise<void> {
  try {
    await mkdir(dirname(toPath), { recursive: true });
    await cp(fromPath, toPath, { recursive: true });
  }
  catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
}

function renderPackageReadme(caseFile: CaseFile): string {
  return [
    "# Forensic Repo Surgeon Proof Package",
    "",
    "Models propose. Verifiers decide. This package contains both: the fixture (human-authored) proof and the model-authored proof, evaluated by the same deterministic verifier.",
    "",
    "This folder is the no-setup, static review package. It does not require Claude Code, Node, Playwright, the target app, or the producer machine.",
    "",
    "## Headline artifacts",
    "",
    "- `artifacts/index.html` - demo cockpit, fixture vs model side-by-side",
    `- \`artifacts/${caseFile.id}/index.html\` - detailed validation dossier with Model Authorship card`,
    `- \`artifacts/${caseFile.id}/scorecard.json\` - fixture proof scorecard`,
    `- \`artifacts/${caseFile.id}/model-scorecard.json\` - model-authored proof scorecard (claude-opus-4-7 via Claude Code SDK)`,
    `- \`artifacts/${caseFile.id}/model-agent-trace.json\` - full agent transcript: turns, tool calls, files read/edited, cost, tokens`,
    `- \`artifacts/${caseFile.id}/model-agent-trace.md\` - human-readable agent transcript`,
    `- \`artifacts/${caseFile.id}/model-patch.diff\` - the diff Opus 4.7 actually authored inside the target repo`,
    "",
    "## Supporting artifacts",
    "",
    "- `artifacts/crwa-mobile-onboarding-dialog/index.html` - second case dossier (model and fixture)",
    `- \`artifacts/${caseFile.id}/PR.md\` - PR-style repair report`,
    `- \`artifacts/${caseFile.id}/before-verify.json\` - before-state negative control`,
    `- \`artifacts/${caseFile.id}/reasoner.md\` - bounded reasoner artifact (single-call diagnosis, separate from the agent loop)`,
    `- \`artifacts/${caseFile.id}/evidence-manifest.md\` - case artifact hash summary`,
    `- \`artifacts/${caseFile.id}/redaction-report.json\` - artifact redaction summary`,
    `- \`artifacts/${caseFile.id}/github-check.md\` - PR/check-ready proof summary`,
    "- `package-integrity.md` - exported package hash summary",
    "- `artifacts/evals/proof-evaluation.md` - aggregate proof evaluation and current confidence bar",
    "- `evals/proof-benchmark.json` - benchmark contract",
    "- `docs/quickstart.md` - install, rerun, and extension path",
    "- `docs/architecture.md` - proof boundary and scaling model",
    "- `docs/positioning.md` - product differentiation from broad coding and review agents",
    "",
    "## Truth boundary",
    "",
    "The model agent loop runs through the official `@anthropic-ai/claude-agent-sdk` package using `claude-opus-4-7`. It is given Read, Glob, Grep, and Edit tools inside the target repository. It cannot run shell commands, fetch the web, or write tests. After the agent finishes, `git diff` captures its changes as `model-patch.diff`. The fixture pipeline above already produced a verified scorecard. The model patch is then evaluated against the SAME deterministic gates: artifact completeness, verification pass rate, patch relevance, and absence of console regressions. The verifier is identical for both. That is the proof boundary.",
    "",
    "The recorded `doctor.json` describes the producer machine. It does not validate the evaluator's current machine.",
    "",
    "This public copy privacy-sanitizes local paths and text secrets, including text inside browser trace ZIPs. Dossiers are regenerated from the sanitized inputs and case/package hashes are refreshed. Verification outcomes are retained recorded results, not a fresh model or verifier run. Operational originals are not changed. Screenshots remain recorded binary evidence; this is not a claim of universal anonymization.",
    "",
    "## Rerun the live pipeline",
    "",
    "```bash",
    "pnpm install",
    "# Set ANTHROPIC_API_KEY in .env.local first.",
    "pnpm demo:live-opus   # fixture + Opus reasoner + Claude Code agent loop",
    "pnpm demo             # fixture + deterministic fallback only",
    "```",
    "",
    "Claude / Claude Code is not required to view this package. The recorded model-agent-trace.json shows the actual tool calls, files Opus read and edited, tokens, cost, and final assistant text from the live run.",
    "",
  ].join("\n");
}
