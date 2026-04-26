import { existsSync } from "node:fs";

import { runCommand } from "./command.ts";
import {
  getCrwaTargetRepoPath,
  startCrwaTarget,
  stopCrwaTarget,
} from "./crwa-lifecycle.ts";
import { type PatchStatus, type TargetAdapter } from "./types.ts";

export { CRWA_PORTS, getCrwaTargetRepoPath } from "./crwa-lifecycle.ts";

export function createCrwaTargetAdapter(): TargetAdapter {
  return {
    id: "cypress-realworld-app",
    repoPath: getCrwaTargetRepoPath(),
    baseUrl: "http://localhost:3000",
    async start() {
      return startCrwaTarget();
    },
    async stop() {
      return stopCrwaTarget();
    },
    async setPatchState(state, patchPath) {
      const repoPath = getCrwaTargetRepoPath();

      if (!existsSync(repoPath)) {
        throw new Error(`Demo target is missing at ${repoPath}. Run pnpm surgeon target setup first.`);
      }

      if (!existsSync(patchPath)) {
        throw new Error(`Patch artifact is missing at ${patchPath}.`);
      }

      if (state === "clean") {
        if (await canApplyPatch(repoPath, patchPath, true)) {
          await applyPatch(repoPath, patchPath, true);
          return "Target patch removed for before-state capture.";
        }

        if (await canApplyPatch(repoPath, patchPath, false)) {
          return "Target is already in before-state.";
        }
      }

      if (state === "patched") {
        if (await canApplyPatch(repoPath, patchPath, false)) {
          await applyPatch(repoPath, patchPath, false);
          return "Target patch applied for after-state verification.";
        }

        if (await canApplyPatch(repoPath, patchPath, true)) {
          return "Target patch is already applied.";
        }
      }

      throw new Error(`Cannot determine patch state for ${repoPath}. Check for conflicting local edits.`);
    },
    async getPatchStatus(patchPath) {
      return getCrwaPatchStatus(patchPath);
    },
  };
}

export async function getCrwaPatchStatus(patchPath: string): Promise<PatchStatus> {
  const repoPath = getCrwaTargetRepoPath();

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
    "-C",
    repoPath,
    "apply",
    "--ignore-space-change",
    "--ignore-whitespace",
    "--check",
  ];

  if (reverse) {
    args.push("--reverse");
  }

  args.push(patchPath);

  const result = await runCommand("git", args, { rejectOnFailure: false });
  return result.exitCode === 0;
}

async function applyPatch(repoPath: string, patchPath: string, reverse: boolean): Promise<void> {
  const args = ["-C", repoPath, "apply", "--ignore-space-change", "--ignore-whitespace"];

  if (reverse) {
    args.push("--reverse");
  }

  args.push(patchPath);
  await runCommand("git", args);
}
