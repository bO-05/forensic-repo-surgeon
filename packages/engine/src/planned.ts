import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { type CaseFile } from "../../schemas/src/index.ts";

type PlannedCaseArtifact = {
  caseId: string;
  status: "planned";
  generatedAt: string;
  title: string;
  reason: string;
  nextProofStep: string;
};

export async function markCasePlanned(
  caseFile: CaseFile,
  options: { reason?: string; nextProofStep?: string } = {},
): Promise<string> {
  const outPath = resolve(caseFile.artifacts.directory, "planned.json");
  const artifact: PlannedCaseArtifact = {
    caseId: caseFile.id,
    status: "planned",
    generatedAt: new Date().toISOString(),
    title: caseFile.title,
    reason:
      options.reason ??
      "Second same-target case is reserved for safe expansion after the primary golden path remains stable.",
    nextProofStep:
      options.nextProofStep ??
      "Add case-specific verification assertions and run the same scorecard proof gates before marking verified.",
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return outPath;
}
