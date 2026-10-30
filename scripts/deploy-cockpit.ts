/**
 * Deploys the static cockpit (`dist/demo-package/artifacts/`) to Vercel.
 *
 * Why a separate stage step: the production export lives at
 * `dist/demo-package/artifacts/index.html`, but a static host needs the
 * cockpit at the *root* of the deployed directory. We mirror the artifacts
 * folder into a new ignored stage, preserving the existing project linkage.
 * Staging never deploys or creates a Vercel project.
 *
 * Run with:
 *   pnpm stage:cockpit
 *   pnpm deploy:cockpit --project-id <confirmed-id> --org-id <confirmed-id>
 *
 * Requires:
 *   - `vercel` CLI v47.2.2+ installed and logged in
 *   - A reviewed privacy-sanitized export of the existing recording
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = "dist/demo-package/artifacts";
const STAGE_DIR = "dist/forensic-cockpit";

const VERCEL_CONFIG = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  buildCommand: null,
  installCommand: null,
  outputDirectory: ".",
  cleanUrls: false,
  trailingSlash: false,
  headers: [
    {
      source: "/(.*)\\.(html)",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
    {
      source: "/(.*)\\.(png|jpg|jpeg|svg|webp|gif)",
      headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=86400" }],
    },
    {
      source: "/(.*)\\.(json|md|diff|ndjson|zip)",
      headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=600" }],
    },
  ],
};

type PublicEntry = { path: string; sha256: string; sizeBytes: number };

async function verifyFiles(directory: string, entries: PublicEntry[]): Promise<void> {
  const files: string[] = [];
  const walk = async (path: string, prefix = "") => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("Refusing to stage a public symlink.");
      if (entry.isDirectory()) await walk(join(path, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  await walk(directory);
  const expected = entries.map(entry => entry.path);
  if (new Set(expected).size !== expected.length || JSON.stringify(files.sort()) !== JSON.stringify(expected.sort())) throw new Error("Public artifact inventory differs from the export integrity map. Re-export first.");
  for (const entry of entries) {
    if (entry.path.startsWith("/") || entry.path.split(/[\\/]/u).includes("..") || /^[A-Za-z]:/u.test(entry.path)) throw new Error("Unsafe public integrity path.");
    const bytes = await readFile(resolve(directory, entry.path));
    if (bytes.length !== entry.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Public artifacts changed after export. Re-export first.");
  }
}

export async function stageCockpit(options: { sourceDir?: string; stageParent?: string; linkPath?: string } = {}): Promise<string> {
  const sourceAbs = resolve(options.sourceDir ?? SOURCE_DIR);
  const notice = JSON.parse(await readFile(resolve(sourceAbs, "public-export-notice.json"), "utf8"));
  if (notice.policyVersion !== "2026-10-30.public-copy" || notice.recordedEvidence !== true || notice.newModelOrVerifierRun !== false) throw new Error("A privacy-sanitized recorded export is required. Re-export existing evidence; no live model run is needed.");
  const integrity = JSON.parse(await readFile(resolve(sourceAbs, "../package-integrity.json"), "utf8")) as { files: PublicEntry[] };
  const entries = integrity.files.filter(entry => entry.path.startsWith("artifacts/")).map(entry => ({ ...entry, path: entry.path.slice("artifacts/".length) }));
  if (entries.length === 0) throw new Error("Empty public artifact integrity map.");
  await verifyFiles(sourceAbs, entries);
  const parent = resolve(options.stageParent ?? "dist");
  await mkdir(parent, { recursive: true });
  const stageAbs = await mkdtemp(join(parent, "forensic-cockpit-stage-"));
  await cp(sourceAbs, stageAbs, { recursive: true });
  await verifyFiles(stageAbs, entries);
  const link = resolve(options.linkPath ?? `${STAGE_DIR}/.vercel/project.json`);
  if (existsSync(link)) {
    await mkdir(resolve(stageAbs, ".vercel"));
    await cp(link, resolve(stageAbs, ".vercel/project.json"));
  }
  await writeFile(resolve(stageAbs, "vercel.json"), `${JSON.stringify(VERCEL_CONFIG, null, 2)}\n`, "utf8");
  return stageAbs;
}

export async function assertDeploymentTarget(stageAbs: string, projectId?: string, orgId?: string): Promise<{ projectId: string; orgId: string }> {
  if (!projectId || !orgId) throw new Error("Production requires explicit --project-id and --org-id matching a confirmed existing Vercel project.");
  const link = JSON.parse(await readFile(resolve(stageAbs, ".vercel/project.json"), "utf8"));
  if (link.projectId !== projectId || link.orgId !== orgId) throw new Error("Vercel project linkage does not match the confirmed deployment target.");
  return { projectId, orgId };
}

export function cockpitDeploymentEnvironment(projectId: string, orgId: string, environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...environment, VERCEL_PROJECT_ID: projectId, VERCEL_ORG_ID: orgId };
}

async function deploy(stageAbs: string, projectId?: string, orgId?: string): Promise<void> {
  const target = await assertDeploymentTarget(stageAbs, projectId, orgId);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.platform === "win32" ? "vercel.cmd" : "vercel", ["deploy", "--prod", "--yes"], {
      cwd: stageAbs,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: cockpitDeploymentEnvironment(target.projectId, target.orgId),
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      }
      else {
        rejectPromise(new Error(`vercel deploy exited with code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  const value = (name: string) => flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined;
  const stageAbs = await stageCockpit();
  console.log(`[deploy-cockpit] staged: dist/${basename(stageAbs)}. Existing stages and project linkage were not deleted.`);
  if (flags.includes("--deploy")) {
    await deploy(stageAbs, value("--project-id"), value("--org-id"));
    console.log("[deploy-cockpit] production deployment completed for the confirmed linked project.");
  } else {
    console.log("[deploy-cockpit] stage only. No deployment or new project was created.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
