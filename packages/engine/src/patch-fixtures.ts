import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

export function getCasePatchFixturePath(caseFile: CaseFile): string {
  return resolve("patches", `${caseFile.id}.diff`);
}

export async function ensureCasePatchArtifact(caseFile: CaseFile): Promise<string> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const artifactPatchPath = resolve(manifest.files.patch);
  const fixturePatchPath = getCasePatchFixturePath(caseFile);

  if (existsSync(artifactPatchPath)) {
    return artifactPatchPath;
  }

  if (!existsSync(fixturePatchPath)) {
    return artifactPatchPath;
  }

  await mkdir(dirname(artifactPatchPath), { recursive: true });
  await copyFile(fixturePatchPath, artifactPatchPath);

  return artifactPatchPath;
}
