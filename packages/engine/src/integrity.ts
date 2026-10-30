import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

type IntegrityEntry = {
  key?: string;
  path: string;
  sha256: string;
  sizeBytes: number;
};

type IntegritySummary = {
  integrityType: "unsigned-sha256-map";
  signed: false;
  note: string;
  fileCount: number;
  bundleFingerprint: string;
  files: IntegrityEntry[];
};

const CASE_INTEGRITY_KEYS = [
  "input",
  "screenshot",
  "trace",
  "console",
  "network",
  "axTree",
  "domSnapshot",
  "candidates",
  "patch",
  "beforeVerify",
  "success",
  "verify",
  "hypothesis",
  "reasoner",
  "reasonerReport",
  "redactionReport",
  "doctor",
  "scorecard",
  "report",
] as const;

const EXPORTED_INTEGRITY_EXCLUSIONS = new Set([
  "package-manifest.json",
  "package-integrity.json",
  "package-integrity.md",
]);

export async function generateCaseEvidenceManifest(caseFile: CaseFile, options: { relativeTo?: string } = {}): Promise<string> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const integrityKeys = caseFile.verification.negativeControl
    ? CASE_INTEGRITY_KEYS
    : CASE_INTEGRITY_KEYS.filter((key) => key !== "beforeVerify");
  const entries = await Promise.all(
    integrityKeys.map(async (key) => {
      const path = resolve(manifest.files[key]);
      return hashFile(path, options.relativeTo ? relative(resolve(options.relativeTo), path) : manifest.files[key], key);
    }),
  );
  const summary = buildIntegritySummary(entries);
  const jsonPath = resolve(manifest.files.evidenceManifest);
  const mdPath = resolve(manifest.files.evidenceReport);
  const payload = {
    caseId: caseFile.id,
    generatedAt: new Date().toISOString(),
    ...summary,
  };

  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const displayCase = options.relativeTo
    ? { ...caseFile, artifacts: { ...caseFile.artifacts, directory: normalizePath(relative(resolve(options.relativeTo), resolve(caseFile.artifacts.directory))) } }
    : caseFile;
  await writeFile(mdPath, renderCaseEvidenceMarkdown(displayCase, payload), "utf8");

  return jsonPath;
}

export async function generateExportIntegrityManifest(outDir: string, caseFile: CaseFile): Promise<{
  jsonPath: string;
  markdownPath: string;
  summary: IntegritySummary;
}> {
  const resolvedOutDir = resolve(outDir);
  const relativePaths = await listFilesRecursively(resolvedOutDir);
  const pathsToHash = relativePaths.filter((path) => !EXPORTED_INTEGRITY_EXCLUSIONS.has(path));
  const entries = await Promise.all(
    pathsToHash.map(async (path) => {
      const absolutePath = resolve(resolvedOutDir, path);
      return hashFile(absolutePath, path);
    }),
  );
  const summary = buildIntegritySummary(entries);
  const jsonPath = resolve(resolvedOutDir, "package-integrity.json");
  const markdownPath = resolve(resolvedOutDir, "package-integrity.md");
  const payload = {
    caseId: caseFile.id,
    generatedAt: new Date().toISOString(),
    root: ".",
    ...summary,
  };

  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderPackageIntegrityMarkdown(caseFile, payload), "utf8");

  return {
    jsonPath,
    markdownPath,
    summary,
  };
}

async function hashFile(path: string, relativePath: string, key?: string): Promise<IntegrityEntry> {
  const [buffer, fileStat] = await Promise.all([readFile(path), stat(path)]);

  return {
    key,
    path: normalizePath(relativePath),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: fileStat.size,
  };
}

function buildIntegritySummary(files: IntegrityEntry[]): IntegritySummary {
  const normalizedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const bundleFingerprint = createHash("sha256")
    .update(normalizedFiles.map((file) => `${file.sha256}  ${file.path}`).join("\n"))
    .digest("hex");

  return {
    integrityType: "unsigned-sha256-map",
    signed: false,
    note:
      "This is an unsigned SHA-256 integrity map. It helps compare copies of the package or case artifacts, but it is not independent signed provenance.",
    fileCount: normalizedFiles.length,
    bundleFingerprint,
    files: normalizedFiles,
  };
}

function renderCaseEvidenceMarkdown(
  caseFile: CaseFile,
  payload: {
    caseId: string;
    generatedAt: string;
  } & IntegritySummary,
): string {
  return [
    "# Evidence Integrity Manifest",
    "",
    `Case: \`${caseFile.id}\``,
    `Generated at: \`${payload.generatedAt}\``,
    `Bundle fingerprint: \`${payload.bundleFingerprint}\``,
    "",
    payload.note,
    "",
    "## Review Order",
    "",
    `1. Compare \`${caseFile.artifacts.directory}/failure.png\` and \`${caseFile.artifacts.directory}/success.png\`.`,
    `2. Read \`${caseFile.artifacts.directory}/reasoner.md\`, \`${caseFile.artifacts.directory}/PR.md\`, and \`${caseFile.artifacts.directory}/scorecard.json\`.`,
    `3. Use the hashes below to compare this artifact set against another copy.`,
    "",
    "## Hashed Files",
    "",
    ...payload.files.map((file) =>
      `- ${file.key ? `\`${file.key}\`` : "`file`"} -> \`${file.path}\` sha256 \`${file.sha256}\` size \`${file.sizeBytes}\``,
    ),
    "",
  ].join("\n");
}

function renderPackageIntegrityMarkdown(
  caseFile: CaseFile,
  payload: {
    caseId: string;
    generatedAt: string;
    root: string;
  } & IntegritySummary,
): string {
  return [
    "# Package Integrity",
    "",
    `Case: \`${caseFile.id}\``,
    `Generated at: \`${payload.generatedAt}\``,
    `Bundle fingerprint: \`${payload.bundleFingerprint}\``,
    `Hashed files: \`${payload.fileCount}\``,
    "",
    payload.note,
    "",
    "## Review First",
    "",
    "- `artifacts/index.html`",
    `- \`artifacts/${caseFile.id}/index.html\``,
    `- \`artifacts/${caseFile.id}/PR.md\``,
    `- \`artifacts/${caseFile.id}/evidence-manifest.md\``,
    "",
    "## Hashed Files",
    "",
    ...payload.files.map((file) => `- \`${file.path}\` sha256 \`${file.sha256}\` size \`${file.sizeBytes}\``),
    "",
  ].join("\n");
}

async function listFilesRecursively(root: string, currentDir = root): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(currentDir, entry.name);

      if (entry.isDirectory()) {
        return listFilesRecursively(root, absolutePath);
      }

      return [normalizePath(relative(root, absolutePath))];
    }),
  );

  return paths.flat();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
