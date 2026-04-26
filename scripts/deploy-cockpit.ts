/**
 * Deploys the static cockpit (`dist/demo-package/artifacts/`) to Vercel.
 *
 * Why a separate stage step: the production export lives at
 * `dist/demo-package/artifacts/index.html`, but a static host needs the
 * cockpit at the *root* of the deployed directory. We mirror the artifacts
 * folder into `dist/forensic-cockpit/`, drop a `vercel.json` with cache
 * headers, then `vercel deploy --prod --yes`. The directory name becomes the
 * Vercel project name on first deploy.
 *
 * Run with:
 *   pnpm deploy:cockpit
 *
 * Requires:
 *   - `vercel` CLI v47.2.2+ installed and logged in
 *   - `dist/demo-package/artifacts/` populated (run `pnpm demo` first)
 */
import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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

async function stage(): Promise<void> {
  const sourceAbs = resolve(SOURCE_DIR);
  const stageAbs = resolve(STAGE_DIR);

  if (!existsSync(sourceAbs)) {
    throw new Error(
      `${SOURCE_DIR} does not exist. Run \`pnpm demo\` (or \`pnpm demo:live-opus\`) first to populate it.`,
    );
  }

  console.log(`[deploy-cockpit] staging ${SOURCE_DIR} -> ${STAGE_DIR}`);
  await rm(stageAbs, { recursive: true, force: true });
  await mkdir(stageAbs, { recursive: true });
  await cp(sourceAbs, stageAbs, { recursive: true });
  await writeFile(resolve(stageAbs, "vercel.json"), `${JSON.stringify(VERCEL_CONFIG, null, 2)}\n`, "utf8");
}

async function deploy(): Promise<void> {
  const stageAbs = resolve(STAGE_DIR);
  console.log(`[deploy-cockpit] running: vercel deploy --prod --yes (cwd: ${STAGE_DIR})`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("vercel", ["deploy", "--prod", "--yes"], {
      cwd: stageAbs,
      stdio: "inherit",
      shell: true,
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
  await stage();
  await deploy();
  console.log("[deploy-cockpit] done. Production alias: https://forensic-cockpit.vercel.app");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
