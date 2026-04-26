import { existsSync } from "node:fs";
import { mkdir, statfs, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { ensureCasePatchArtifact, getCasePatchFixturePath } from "./patch-fixtures.ts";
import { CRWA_PORTS } from "./targets/crwa.ts";
import { runCommand } from "./targets/command.ts";
import { resolveTargetRuntime } from "./targets/crwa-lifecycle.ts";
import { createTargetAdapter } from "./targets/factory.ts";
import { type TargetAdapter } from "./targets/types.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

type DoctorStatus = "passing" | "warning" | "failing";

type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  detail: string;
  remedy?: string;
};

type DoctorReport = {
  caseId: string;
  generatedAt: string;
  status: DoctorStatus;
  target: {
    id: string;
    repoPath: string;
  };
  checks: DoctorCheck[];
};

export async function runDoctor(caseFile: CaseFile): Promise<string> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const outPath = resolve(manifest.files.doctor ?? `${caseFile.artifacts.directory}/doctor.json`);
  await ensureCasePatchArtifact(caseFile);
  const adapter = createTargetAdapter(caseFile);
  const checks = await createDoctorChecks(caseFile, adapter);
  const report: DoctorReport = {
    caseId: caseFile.id,
    generatedAt: new Date().toISOString(),
    status: summarizeStatus(checks),
    target: {
      id: adapter.id,
      repoPath: adapter.repoPath,
    },
    checks,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outPath;
}

async function createDoctorChecks(caseFile: CaseFile, adapter: TargetAdapter): Promise<DoctorCheck[]> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const patchPath = resolve(manifest.files.patch);
  const checks: DoctorCheck[] = [
    checkNodeVersion(),
    checkPath(`${adapter.id} target repo`, adapter.repoPath, adapter.id === "cypress-realworld-app" ? "Run pnpm surgeon target setup." : "Create the target repo path or update target.repo in the case file."),
    checkPath("case patch artifact", patchPath, "Run the case pipeline once or restore patch.diff."),
    await checkDiskFree("workspace drive", resolve(".")),
    await checkDiskFree("target drive", adapter.repoPath),
    await checkPatchState(adapter, patchPath),
  ];

  if (adapter.id === "cypress-realworld-app") {
    checks.splice(
      1,
      0,
      checkTargetRuntime(),
      await checkCommand("pnpm package manager", "pnpm", ["--version"]),
      checkPath("case patch fixture", getCasePatchFixturePath(caseFile), "Restore the tracked patch fixture under patches/."),
      await checkPortsFree(),
    );
  }

  return checks;
}

function checkTargetRuntime(): DoctorCheck {
  const runtime = resolveTargetRuntime();

  if (existsSync(runtime.node)) {
    return {
      name: "target Node runtime",
      status: "passing",
      detail: runtime.detail,
    };
  }

  return {
    name: "target Node runtime",
    status: "failing",
    detail: `Missing target Node runtime: ${runtime.node}`,
    remedy: "Install Node on PATH or set SURGEON_NODE_DIR to a target runtime directory.",
  };
}

function checkNodeVersion(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

  if (major >= 20) {
    return {
      name: "controller Node runtime",
      status: "passing",
      detail: `Node ${process.versions.node}; target app runtime is checked separately.`,
    };
  }

  return {
    name: "controller Node runtime",
    status: "warning",
    detail: `Node ${process.versions.node}; controller is validated on Node 20+.`,
    remedy: "Use Node 20+ before recording the demo.",
  };
}

async function checkCommand(name: string, command: string, args: string[]): Promise<DoctorCheck> {
  try {
    const result = await runCommand(command, args, { timeoutMs: 30_000 });
    return {
      name,
      status: "passing",
      detail: result.detail || `${command} is available.`,
    };
  }
  catch (error) {
    return {
      name,
      status: "failing",
      detail: error instanceof Error ? error.message : String(error),
      remedy: `Install or repair ${command} before running the demo.`,
    };
  }
}

function checkPath(name: string, path: string, remedy?: string): DoctorCheck {
  if (existsSync(path)) {
    return {
      name,
      status: "passing",
      detail: path,
    };
  }

  return {
    name,
    status: "failing",
    detail: `Missing: ${path}`,
    remedy,
  };
}

async function checkDiskFree(name: string, path: string): Promise<DoctorCheck> {
  try {
    const stats = await statfs(path);
    const freeBytes = stats.bavail * stats.bsize;
    const freeGiB = freeBytes / 1024 / 1024 / 1024;

    if (freeGiB < 2) {
      return {
        name,
        status: "failing",
        detail: `${path} has ${freeGiB.toFixed(1)} GiB free.`,
        remedy: "Free disk space before running browser traces and dependency installs.",
      };
    }

    if (freeGiB < 8) {
      return {
        name,
        status: "warning",
        detail: `${path} has ${freeGiB.toFixed(1)} GiB free.`,
        remedy: "Free more disk space before recording the final demo if possible.",
      };
    }

    return {
      name,
      status: "passing",
      detail: `${path} has ${freeGiB.toFixed(1)} GiB free.`,
    };
  }
  catch (error) {
    return {
      name,
      status: "warning",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkPortsFree(): Promise<DoctorCheck> {
  const portStates = await Promise.all(
    CRWA_PORTS.map(async (port) => ({
      port,
      listening: await isPortListening(port),
    })),
  );
  const occupied = portStates.filter((portState) => portState.listening);

  if (occupied.length === 0) {
    return {
      name: "demo ports",
      status: "passing",
      detail: `Ports ${CRWA_PORTS.join(", ")} are free.`,
    };
  }

  return {
    name: "demo ports",
    status: "warning",
    detail: `Ports ${occupied.map((portState) => portState.port).join(", ")} are already listening.`,
    remedy: "Run pnpm surgeon target stop before the final demo if these are stale target processes.",
  };
}

async function checkPatchState(adapter: TargetAdapter, patchPath: string): Promise<DoctorCheck> {
  const patchStatus = await adapter.getPatchStatus(patchPath);

  if (patchStatus.state === "clean") {
    return {
      name: "target patch state",
      status: "passing",
      detail: "Target is in before-state and patch can be applied.",
    };
  }

  if (patchStatus.state === "patched") {
    return {
      name: "target patch state",
      status: "passing",
      detail: "Target is currently patched and can be reversed for before-state capture.",
    };
  }

  if (patchStatus.state === "missing") {
    return {
      name: "target patch state",
      status: "failing",
      detail: "Target repo or patch artifact is missing.",
      remedy: adapter.id === "cypress-realworld-app"
        ? "Run pnpm surgeon target setup and confirm the case patch.diff exists."
        : "Confirm the external target repo exists and provide a patch artifact or lifecycle patch command.",
    };
  }

  return {
    name: "target patch state",
    status: "failing",
    detail: "Patch cannot be applied or reversed cleanly.",
    remedy: "Check the target repo for conflicting edits before running the demo.",
  };
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (isListening: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(isListening);
    };

    socket.setTimeout(800);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

function summarizeStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "failing")) {
    return "failing";
  }

  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }

  return "passing";
}
