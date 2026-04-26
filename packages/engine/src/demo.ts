import { resolve } from "node:path";

import { exportDemoPackage } from "./export-package.ts";
import { generateProofEvaluation } from "./evaluate.ts";
import { generateDemoHub } from "./demo-hub.ts";
import { loadCaseFile } from "./intake.ts";
import { generateModelScorecard, type ModelScorecard } from "./model-scorecard.ts";
import { runModelPatchAgent, type ModelPatchTrace } from "./model-patch.ts";
import { runCase } from "./run.ts";
import { getCrwaTargetRepoPath, setupCrwaTarget, stopCrwaTarget } from "./targets/crwa-lifecycle.ts";

const DEMO_CASES = [
  "cases/cypress-realworld-mobile-date-range-drawer.case.json",
  "cases/cypress-realworld-mobile-onboarding-dialog.case.json",
] as const;

export type DemoCaseResult = {
  id: string;
  artifactDirectory: string;
  scorecardPath: string;
  modelTrace?: ModelPatchTrace;
  modelScorecard?: ModelScorecard;
};

export type DemoRunResult = {
  cases: DemoCaseResult[];
  evaluationPath: string;
  exportPath: string;
  cockpitPath: string;
};

export type RunDemoOptions = {
  /**
   * Run the model-authored patch pass alongside the fixture pipeline.
   * Requires ANTHROPIC_API_KEY. The fixture proof always still runs.
   */
  modelPatch?: boolean;
};

export async function runDemo(options: RunDemoOptions = {}): Promise<DemoRunResult> {
  await setupCrwaTarget();
  await stopCrwaTarget({ quiet: true });

  const cases: DemoCaseResult[] = [];
  for (const casePath of DEMO_CASES) {
    const caseFile = await loadCaseFile(casePath);
    const artifactDirectory = await runCase(caseFile);

    let modelTrace: ModelPatchTrace | undefined;
    let modelScorecard: ModelScorecard | undefined;

    if (options.modelPatch) {
      // Side-by-side: the fixture proof above is golden. Now have Opus
      // 4.7, via the Claude Code agent loop, propose its own patch and
      // run it through the same verifier.
      const targetRepoPath = getCrwaTargetRepoPath();
      const modelResult = await runModelPatchAgent(caseFile, { targetRepoPath });
      modelTrace = modelResult.trace;
      modelScorecard = await generateModelScorecard(caseFile);
    }

    cases.push({
      id: caseFile.id,
      artifactDirectory,
      scorecardPath: resolve(caseFile.artifacts.directory, "scorecard.json"),
      modelTrace,
      modelScorecard,
    });
  }

  const primaryCase = await loadCaseFile(DEMO_CASES[0]);
  const evaluationPath = await generateProofEvaluation({
    manifestPath: "evals/proof-benchmark.json",
  });
  const cockpitPath = await generateDemoHub(primaryCase);
  const exportPath = await exportDemoPackage(primaryCase);

  return {
    cases,
    evaluationPath,
    exportPath,
    cockpitPath,
  };
}
