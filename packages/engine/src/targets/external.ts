import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { isAbsolute, join, resolve } from "node:path";

import { type CaseFile } from "../../../schemas/src/index.ts";
import { resolveExecutable, runCommand } from "./command.ts";
import { type PatchState, type PatchStatus, type TargetAdapter } from "./types.ts";

type LifecycleCommand = string[];

export function createExternalTargetAdapter(caseFile: CaseFile): TargetAdapter {
  const repoPath = resolveExternalRepoPath(caseFile.target.repo);
  const lifecycle = caseFile.target.lifecycle;
  const cwd = lifecycle?.cwd ? resolve(lifecycle.cwd) : repoPath;
  let startedProcess: ChildProcess | undefined;

  return {
    id: "external",
    repoPath,
    baseUrl: caseFile.target.baseUrl,
    async start() {
      if (lifecycle?.setupCommand) {
        await runLifecycleCommand(lifecycle.setupCommand, cwd);
      }

      if (!lifecycle?.startCommand) {
        return `Using already-running external target at ${caseFile.target.baseUrl}.`;
      }

      startedProcess = await spawnLifecycleCommand(lifecycle.startCommand, cwd);
      await waitForHttpOk(lifecycle.readyUrl ?? caseFile.target.baseUrl, lifecycle.readyTimeoutMs ?? 120_000);
      return `Started external target at ${caseFile.target.baseUrl} pid=${startedProcess.pid ?? "unknown"}.`;
    },
    async stop() {
      if (lifecycle?.stopCommand) {
        await runLifecycleCommand(lifecycle.stopCommand, cwd);
        return "Stopped external target with configured stop command.";
      }

      if (startedProcess?.pid) {
        await stopProcess(startedProcess.pid);
        return `Stopped managed external target pid=${startedProcess.pid}.`;
      }

      return "No managed external target to stop.";
    },
    async setPatchState(state, patchPath) {
      if (state === "patched" && lifecycle?.applyPatchCommand) {
        await runLifecycleCommand(lifecycle.applyPatchCommand, cwd, patchPath);
        return "Applied external target patch with configured command.";
      }

      if (state === "clean" && lifecycle?.reversePatchCommand) {
        await runLifecycleCommand(lifecycle.reversePatchCommand, cwd, patchPath);
        return "Reversed external target patch with configured command.";
      }

      return setGitPatchState(repoPath, state, patchPath);
    },
    async getPatchStatus(patchPath) {
      return getGitPatchStatus(repoPath, patchPath);
    },
  };
}

function resolveExternalRepoPath(repo: string): string {
  return isAbsolute(repo) ? repo : resolve(repo);
}

async function runLifecycleCommand(command: LifecycleCommand, cwd: string, patchPath?: string): Promise<void> {
  const [executable, ...args] = command;

  if (!executable) {
    throw new Error("Lifecycle command cannot be empty.");
  }

  await runCommand(executable, args, {
    cwd,
    env: {
      ...process.env,
      SURGEON_PATCH_PATH: patchPath ?? process.env.SURGEON_PATCH_PATH,
    },
    captureOutput: false,
    timeoutMs: 900_000,
  });
}

async function spawnLifecycleCommand(command: LifecycleCommand, cwd: string): Promise<ChildProcess> {
  const [executable, ...args] = command;

  if (!executable) {
    throw new Error("Lifecycle command cannot be empty.");
  }

  const resolvedExecutable = resolveExecutable(executable);
  const child = spawn(resolvedExecutable, args, {
    cwd,
    detached: true,
    env: process.env,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });

  await waitForSpawn(child, resolvedExecutable);
  child.unref();
  return child;
}

function waitForSpawn(child: ChildProcess, executable: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("spawn", () => resolvePromise());
    child.once("error", (error) => {
      rejectPromise(new Error(`Failed to start external target command ${executable}: ${error.message}`));
    });
  });
}

async function setGitPatchState(repoPath: string, state: PatchState, patchPath: string): Promise<string> {
  if (!existsSync(repoPath)) {
    throw new Error(`External target repo is missing at ${repoPath}.`);
  }

  if (!existsSync(patchPath)) {
    return `Patch artifact is missing at ${patchPath}; external target patch state unchanged.`;
  }

  if (state === "clean") {
    if (await canApplyPatch(repoPath, patchPath, true)) {
      await applyPatch(repoPath, patchPath, true);
      if (await canApplyPatch(repoPath, patchPath, true)) {
        await applySimpleUnifiedPatch(repoPath, patchPath, true);
      }
      return "External target patch removed for before-state capture.";
    }

    if (await canApplyPatch(repoPath, patchPath, false)) {
      return "External target is already in before-state.";
    }
  }

  if (state === "patched") {
    if (await canApplyPatch(repoPath, patchPath, false)) {
      await applyPatch(repoPath, patchPath, false);
      if (await canApplyPatch(repoPath, patchPath, false)) {
        await applySimpleUnifiedPatch(repoPath, patchPath, false);
      }
      return "External target patch applied for after-state verification.";
    }

    if (await canApplyPatch(repoPath, patchPath, true)) {
      return "External target patch is already applied.";
    }
  }

  throw new Error(`Cannot determine patch state for external target ${repoPath}. Check for conflicting local edits.`);
}

async function getGitPatchStatus(repoPath: string, patchPath: string): Promise<PatchStatus> {
  if (!existsSync(repoPath) || !existsSync(patchPath)) {
    return {
      state: "missing",
      canApply: false,
      canReverse: false,
    };
  }

  const canApply = await canApplyPatch(repoPath, patchPath, false);
  const canReverse = await canApplyPatch(repoPath, patchPath, true);

  if (canApply) {
    return { state: "clean", canApply, canReverse };
  }

  if (canReverse) {
    return { state: "patched", canApply, canReverse };
  }

  return { state: "conflicting", canApply, canReverse };
}

async function canApplyPatch(repoPath: string, patchPath: string, reverse: boolean): Promise<boolean> {
  const args = [
    "apply",
    "--ignore-space-change",
    "--ignore-whitespace",
    "--check",
  ];

  if (reverse) {
    args.push("--reverse");
  }

  args.push(patchPath);

  const result = await runCommand("git", args, { cwd: repoPath, rejectOnFailure: false });
  return result.exitCode === 0;
}

async function applyPatch(repoPath: string, patchPath: string, reverse: boolean): Promise<void> {
  const args = ["apply", "--ignore-space-change", "--ignore-whitespace"];

  if (reverse) {
    args.push("--reverse");
  }

  args.push(patchPath);
  await runCommand("git", args, { cwd: repoPath });
}

async function applySimpleUnifiedPatch(repoPath: string, patchPath: string, reverse: boolean): Promise<void> {
  const patchText = await readFile(patchPath, "utf8");
  const patches = parseSimpleUnifiedPatch(patchText);

  for (const patch of patches) {
    const filePath = join(repoPath, reverse ? patch.oldFile : patch.newFile);
    const current = await readFile(filePath, "utf8");
    const from = reverse ? patch.newText : patch.oldText;
    const to = reverse ? patch.oldText : patch.newText;

    if (!current.includes(from)) {
      continue;
    }

    await writeFile(filePath, current.replace(from, to), "utf8");
  }
}

function parseSimpleUnifiedPatch(patchText: string): Array<{
  oldFile: string;
  newFile: string;
  oldText: string;
  newText: string;
}> {
  const patches: Array<{
    oldFile: string;
    newFile: string;
    oldText: string;
    newText: string;
  }> = [];
  let current: {
    oldFile: string;
    newFile: string;
    oldLines: string[];
    newLines: string[];
  } | undefined;

  for (const line of patchText.split(/\r?\n/u)) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/u);
    if (diffMatch) {
      if (current) {
        patches.push(toSimplePatch(current));
      }
      current = {
        oldFile: diffMatch[1] ?? "",
        newFile: diffMatch[2] ?? "",
        oldLines: [],
        newLines: [],
      };
      continue;
    }

    if (!current || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@")) {
      continue;
    }

    if (line.startsWith("-")) {
      current.oldLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith("+")) {
      current.newLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith(" ")) {
      const context = line.slice(1);
      current.oldLines.push(context);
      current.newLines.push(context);
    }
  }

  if (current) {
    patches.push(toSimplePatch(current));
  }

  return patches;
}

function toSimplePatch(current: {
  oldFile: string;
  newFile: string;
  oldLines: string[];
  newLines: string[];
}): {
  oldFile: string;
  newFile: string;
  oldText: string;
  newText: string;
} {
  return {
    oldFile: current.oldFile,
    newFile: current.newFile,
    oldText: `${current.oldLines.join("\n")}\n`,
    newText: `${current.newLines.join("\n")}\n`,
  };
}

function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolvePromise, rejectPromise) => {
    const attempt = (): void => {
      const request = http.get(url, { timeout: 5_000 }, (response) => {
        response.resume();
        if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 500) {
          resolvePromise();
          return;
        }
        retry();
      });

      request.on("timeout", () => {
        request.destroy();
        retry();
      });
      request.on("error", retry);
    };

    const retry = (): void => {
      if (Date.now() - startedAt >= timeoutMs) {
        rejectPromise(new Error(`External target did not become ready at ${url} within ${timeoutMs}ms.`));
        return;
      }

      setTimeout(attempt, 1_000);
    };

    attempt();
  });
}

async function stopProcess(processId: number): Promise<void> {
  if (process.platform === "win32") {
    await runCommand("taskkill", ["/PID", String(processId), "/T", "/F"], {
      rejectOnFailure: false,
      timeoutMs: 30_000,
    });
    return;
  }

  try {
    process.kill(-processId, "SIGTERM");
  }
  catch {
    process.kill(processId, "SIGTERM");
  }
}
