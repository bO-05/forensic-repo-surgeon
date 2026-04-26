import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { generateDemoHub } from "./demo-hub.ts";
import { runDoctor } from "./doctor.ts";
import { captureEvidence, captureNegativeControl, captureVerification } from "./evidence.ts";
import { exportDemoPackage } from "./export-package.ts";
import { generateGithubCheckSummary } from "./github-summary.ts";
import { generateCaseEvidenceManifest } from "./integrity.ts";
import { generateLocalizationCandidates } from "./localize.ts";
import { ensureCasePatchArtifact } from "./patch-fixtures.ts";
import { generateHypothesisArtifact, generateProofScorecard } from "./proof.ts";
import { generateReasonerArtifacts } from "./reasoner.ts";
import { renderPrReport } from "./report.ts";
import { runCommand } from "./targets/command.ts";
import { createTargetAdapter } from "./targets/factory.ts";
import { generateArtifactViewer } from "./viewer.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

type RunPhaseName =
  | "preflight-doctor"
  | "reset-target-before-state"
  | "start-target"
  | "capture-failing-evidence"
  | "capture-before-verification"
  | "localize-source-candidates"
  | "reason-over-artifacts"
  | "apply-target-patch"
  | "capture-passing-verification"
  | "write-repair-hypothesis"
  | "regenerate-pr-report"
  | "write-artifact-viewer"
  | "write-proof-scorecard"
  | "write-github-summary"
  | "write-evidence-manifest"
  | "refresh-artifact-viewer"
  | "write-demo-cockpit"
  | "export-demo-package"
  | "typecheck-controller"
  | "restore-target-before-state"
  | "stop-target";

type RunPhase = {
  name: RunPhaseName;
  status: "pending" | "running" | "passing" | "failing";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  detail?: string;
  error?: string;
};

type RunTimeline = {
  caseId: string;
  status: "running" | "passing" | "failing";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  command: string;
  options: Required<RunOptions>;
  phases: RunPhase[];
};

export type RunOptions = {
  keepTargetRunning?: boolean;
  restoreOriginal?: boolean;
  skipTypecheck?: boolean;
};

export async function runCase(caseFile: CaseFile, options: RunOptions = {}): Promise<string> {
  const resolvedOptions: Required<RunOptions> = {
    keepTargetRunning: options.keepTargetRunning ?? false,
    restoreOriginal: options.restoreOriginal ?? true,
    skipTypecheck: options.skipTypecheck ?? false,
  };
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const manifest = createPlannedArtifactManifest(caseFile);
  const runPath = resolve(manifest.files.run);
  const startedAt = new Date();
  const timeline: RunTimeline = {
    caseId: caseFile.id,
    status: "running",
    startedAt: startedAt.toISOString(),
    command: `surgeon run --case ${caseFile.id}`,
    options: resolvedOptions,
    phases: [],
  };
  const adapter = createTargetAdapter(caseFile);
  let targetStopped = false;

  await mkdir(artifactDirectory, { recursive: true });
  await ensureCasePatchArtifact(caseFile);
  await writeTimeline(runPath, timeline);

  try {
    await runPhase(timeline, runPath, "preflight-doctor", async () => {
      return runDoctor(caseFile);
    });

    await runPhase(timeline, runPath, "reset-target-before-state", async () => {
      return adapter.setPatchState("clean", resolve(manifest.files.patch));
    });

    await runPhase(timeline, runPath, "start-target", async () => {
      return adapter.start();
    });

    await runPhase(timeline, runPath, "capture-failing-evidence", async () => {
      return captureEvidence(caseFile);
    });

    if (caseFile.verification.negativeControl) {
      await runPhase(timeline, runPath, "capture-before-verification", async () => {
        return captureNegativeControl(caseFile);
      });
    }

    await runPhase(timeline, runPath, "localize-source-candidates", async () => {
      return generateLocalizationCandidates(caseFile);
    });

    await runPhase(timeline, runPath, "reason-over-artifacts", async () => {
      return generateReasonerArtifacts(caseFile);
    });

    await runPhase(timeline, runPath, "apply-target-patch", async () => {
      return adapter.setPatchState("patched", resolve(manifest.files.patch));
    });

    await runPhase(timeline, runPath, "capture-passing-verification", async () => {
      return captureVerification(caseFile);
    });

    await runPhase(timeline, runPath, "write-repair-hypothesis", async () => {
      return generateHypothesisArtifact(caseFile);
    });

    await runPhase(timeline, runPath, "regenerate-pr-report", async () => {
      const candidateReport = await readOptionalJson(resolve(manifest.files.candidates));
      const beforeVerificationReport = await readOptionalJson(resolve(manifest.files.beforeVerify));
      const verificationReport = await readOptionalJson(resolve(manifest.files.verify));
      const reasonerArtifact = await readOptionalJson(resolve(manifest.files.reasoner));
      await writeFile(
        resolve(manifest.files.report),
        renderPrReport(caseFile, candidateReport, verificationReport, reasonerArtifact, beforeVerificationReport),
        "utf8",
      );
      return resolve(manifest.files.report);
    });

    await runPhase(timeline, runPath, "write-artifact-viewer", async () => {
      return generateArtifactViewer(caseFile);
    });

    if (!resolvedOptions.skipTypecheck) {
      await runPhase(timeline, runPath, "typecheck-controller", async () => {
        const result = await runCommand("pnpm", ["typecheck"]);
        return result.detail;
      });
    }

    if (resolvedOptions.restoreOriginal) {
      await runPhase(timeline, runPath, "restore-target-before-state", async () => {
        return adapter.setPatchState("clean", resolve(manifest.files.patch));
      });
    }

    if (!resolvedOptions.keepTargetRunning) {
      await runPhase(timeline, runPath, "stop-target", async () => {
        const detail = await adapter.stop();
        targetStopped = true;
        return detail;
      });
    }

    timeline.status = "passing";

    const completedAt = new Date();
    timeline.endedAt = completedAt.toISOString();
    timeline.durationMs = completedAt.getTime() - startedAt.getTime();
    await writeTimeline(runPath, timeline);

    await runPhase(timeline, runPath, "write-proof-scorecard", async () => {
      return generateProofScorecard(caseFile);
    });

    await runPhase(timeline, runPath, "write-github-summary", async () => {
      return generateGithubCheckSummary(caseFile);
    });

    await runPhase(timeline, runPath, "write-evidence-manifest", async () => {
      return generateCaseEvidenceManifest(caseFile);
    });

    await runPhase(timeline, runPath, "refresh-artifact-viewer", async () => {
      return generateArtifactViewer(caseFile);
    });

    await runPhase(timeline, runPath, "write-demo-cockpit", async () => {
      return generateDemoHub(caseFile);
    });

    await runPhase(timeline, runPath, "export-demo-package", async () => {
      return exportDemoPackage(caseFile);
    });

    await generateArtifactViewer(caseFile);
    await generateDemoHub(caseFile);
    await exportDemoPackage(caseFile);

    return artifactDirectory;
  }
  catch (error) {
    timeline.status = "failing";
    throw error;
  }
  finally {
    if (!resolvedOptions.keepTargetRunning && !targetStopped) {
      await runPhase(timeline, runPath, "stop-target", async () => {
        const detail = await adapter.stop();
        targetStopped = true;
        return detail;
      }).catch(() => undefined);
    }

    const endedAt = new Date();
    timeline.endedAt = endedAt.toISOString();
    timeline.durationMs = endedAt.getTime() - startedAt.getTime();
    await writeTimeline(runPath, timeline);
  }
}

async function runPhase(
  timeline: RunTimeline,
  runPath: string,
  name: RunPhaseName,
  action: () => Promise<string>,
): Promise<void> {
  const startedAt = new Date();
  const phase: RunPhase = {
    name,
    status: "running",
    startedAt: startedAt.toISOString(),
  };

  timeline.phases.push(phase);
  await writeTimeline(runPath, timeline);

  try {
    phase.detail = await action();
    phase.status = "passing";
  }
  catch (error) {
    phase.status = "failing";
    phase.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
  finally {
    const endedAt = new Date();
    phase.endedAt = endedAt.toISOString();
    phase.durationMs = endedAt.getTime() - startedAt.getTime();
    await writeTimeline(runPath, timeline);
  }
}

async function writeTimeline(runPath: string, timeline: RunTimeline): Promise<void> {
  await mkdir(dirname(runPath), { recursive: true });
  await writeFile(runPath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
}

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  }
  catch {
    return undefined;
  }
}
