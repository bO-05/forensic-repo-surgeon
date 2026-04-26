import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CaseFileSchema, type CaseFile } from "../../schemas/src/index.ts";

export async function loadCaseFile(casePath: string): Promise<CaseFile> {
  const resolvedPath = resolve(casePath);
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return CaseFileSchema.parse(parsed);
}

export function summarizeCaseFile(caseFile: CaseFile): string {
  return [
    `Case: ${caseFile.id}`,
    `Title: ${caseFile.title}`,
    `Target: ${caseFile.target.repo}`,
    `Route: ${caseFile.route}`,
    `Viewport: ${caseFile.viewport.name} (${caseFile.viewport.width}x${caseFile.viewport.height})`,
    `Auth: ${caseFile.auth.mode}`,
    `Artifacts: ${caseFile.artifacts.directory}`,
  ].join("\n");
}

