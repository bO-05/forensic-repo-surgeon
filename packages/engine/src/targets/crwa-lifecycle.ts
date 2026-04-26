import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { delimiter, join, resolve } from "node:path";

import { runCommand } from "./command.ts";

export const CRWA_PORTS = [3000, 3001] as const;

type TargetPaths = {
  targetRoot: string;
  repoPath: string;
  logDir: string;
  npmCache: string;
  pidFile: string;
};

type TargetRuntime = {
  node: string;
  npm: {
    command: string;
    args: string[];
  };
  npx: {
    command: string;
    args: string[];
  };
  env: NodeJS.ProcessEnv;
  detail: string;
};

type PidFile = {
  api?: number;
  web?: number;
  appUrl?: string;
  apiUrl?: string;
  startedAt?: string;
};

export function getCrwaTargetPaths(): TargetPaths {
  const targetRoot = resolve(process.env.SURGEON_TARGET_ROOT?.trim() || ".surgeon-targets");
  const repoPath = process.env.SURGEON_TARGET_REPO?.trim()
    ? resolve(process.env.SURGEON_TARGET_REPO)
    : join(targetRoot, "cypress-realworld-app");
  const logDir = process.env.SURGEON_TARGET_LOG_DIR?.trim()
    ? resolve(process.env.SURGEON_TARGET_LOG_DIR)
    : join(targetRoot, "logs");

  return {
    targetRoot,
    repoPath,
    logDir,
    npmCache: join(targetRoot, "npm-cache"),
    pidFile: join(logDir, "target-pids.json"),
  };
}

export function getCrwaTargetRepoPath(): string {
  return getCrwaTargetPaths().repoPath;
}

export function resolveTargetRuntime(): TargetRuntime {
  const paths = getCrwaTargetPaths();
  const configuredNodeDir = process.env.SURGEON_NODE_DIR?.trim();
  const bundledNodeDir = resolve("tools", "node-v22.12.0-win-x64");
  const nodeDir = configuredNodeDir
    ? resolve(configuredNodeDir)
    : process.platform === "win32" && existsSync(join(bundledNodeDir, "node.exe"))
      ? bundledNodeDir
      : undefined;

  if (nodeDir) {
    const extension = process.platform === "win32" ? ".cmd" : "";
    const nodeExecutable = join(nodeDir, process.platform === "win32" ? "node.exe" : "node");

    return {
      node: nodeExecutable,
      npm: existsSync(join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"))
        ? {
            command: nodeExecutable,
            args: [join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")],
          }
        : {
            command: join(nodeDir, `npm${extension}`),
            args: [],
          },
      npx: existsSync(join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"))
        ? {
            command: nodeExecutable,
            args: [join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js")],
          }
        : {
            command: join(nodeDir, `npx${extension}`),
            args: [],
          },
      env: withPathPrefix(nodeDir, {
        CYPRESS_INSTALL_BINARY: "0",
        HUSKY: "0",
        npm_config_cache: paths.npmCache,
      }),
      detail: `target Node runtime: ${nodeExecutable}`,
    };
  }

  return {
    node: process.execPath,
    npm: {
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args: [],
    },
    npx: {
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: [],
    },
    env: {
      ...process.env,
      CYPRESS_INSTALL_BINARY: "0",
      HUSKY: "0",
      npm_config_cache: paths.npmCache,
    },
    detail: `target Node runtime: ${process.execPath}`,
  };
}

export async function setupCrwaTarget(): Promise<string> {
  const paths = getCrwaTargetPaths();
  const runtime = resolveTargetRuntime();

  await mkdir(paths.targetRoot, { recursive: true });
  await mkdir(paths.logDir, { recursive: true });

  if (!existsSync(paths.repoPath)) {
    await runCommand("git", [
      "clone",
      "https://github.com/cypress-io/cypress-realworld-app.git",
      paths.repoPath,
    ], { timeoutMs: 900_000 });
  }

  if (!isTargetInstallComplete(paths.repoPath)) {
    await runCommand(runtime.npm.command, [
      ...runtime.npm.args,
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--cache",
      paths.npmCache,
    ], {
      cwd: paths.repoPath,
      env: runtime.env,
      captureOutput: false,
      timeoutMs: 2_400_000,
    });
  }

  await resetCrwaFixtureFiles(paths.repoPath);
  await runPatchPackage(paths.repoPath, runtime);

  return `Demo target ready at ${paths.repoPath}. ${runtime.detail}`;
}

export async function startCrwaTarget(): Promise<string> {
  const paths = getCrwaTargetPaths();
  const runtime = resolveTargetRuntime();
  const tsNodeBin = join(paths.repoPath, "node_modules", "ts-node", "dist", "bin.js");

  if (!existsSync(paths.repoPath)) {
    throw new Error(`Demo target is missing at ${paths.repoPath}. Run pnpm surgeon target setup first.`);
  }

  if (!existsSync(tsNodeBin)) {
    throw new Error(`Local ts-node runtime is missing at ${tsNodeBin}. Run pnpm surgeon target setup first.`);
  }

  await mkdir(paths.logDir, { recursive: true });
  await stopCrwaTarget({ quiet: true });
  await resetCrwaFixtureFiles(paths.repoPath);

  const apiPid = spawnDetached(runtime.node, [
    tsNodeBin,
    "--transpile-only",
    "-P",
    "tsconfig.tsnode.json",
    "--files",
    "backend/app.ts",
  ], {
    cwd: paths.repoPath,
    env: runtime.env,
    stdoutPath: join(paths.logDir, "api.out.log"),
    stderrPath: join(paths.logDir, "api.err.log"),
  });

  if (!await waitForTcpPort(3001, 180_000)) {
    await stopCrwaTarget({ quiet: true });
    throw new Error(`API did not become ready on http://localhost:3001. Check ${paths.logDir}.`);
  }

  const webPid = spawnDetached(runtime.node, [
    join("node_modules", "vite", "bin", "vite.js"),
    "--host",
    "localhost",
  ], {
    cwd: paths.repoPath,
    env: runtime.env,
    stdoutPath: join(paths.logDir, "web.out.log"),
    stderrPath: join(paths.logDir, "web.err.log"),
  });

  if (!await waitForHttpOk("http://localhost:3000/signin", 240_000)) {
    await stopCrwaTarget({ quiet: true });
    throw new Error(`Web app did not become ready at http://localhost:3000/signin. Check ${paths.logDir}.`);
  }

  const pidFile: PidFile = {
    api: apiPid,
    web: webPid,
    appUrl: "http://localhost:3000/signin",
    apiUrl: "http://localhost:3001",
    startedAt: new Date().toISOString(),
  };
  await writeFile(paths.pidFile, `${JSON.stringify(pidFile, null, 2)}\n`, "utf8");

  return `Demo target ready at http://localhost:3000/signin api=${apiPid} web=${webPid}`;
}

export async function stopCrwaTarget(options: { quiet?: boolean } = {}): Promise<string> {
  const paths = getCrwaTargetPaths();
  const processIds = new Set<number>();

  try {
    const pidFile = JSON.parse(await readFile(paths.pidFile, "utf8")) as PidFile;
    addProcessId(processIds, pidFile.api);
    addProcessId(processIds, pidFile.web);
  }
  catch {
    // No managed process file is fine; the next start will recreate it.
  }

  let stopped = 0;
  for (const processId of processIds) {
    if (await stopProcessTree(processId)) {
      stopped += 1;
    }
  }

  await rm(paths.pidFile, { force: true });

  return options.quiet ? "" : `Stopped ${stopped} demo target process(es).`;
}

async function resetCrwaFixtureFiles(repoPath: string): Promise<void> {
  await copyFile(join(repoPath, "scripts", "mock-aws-exports.js"), join(repoPath, "src", "aws-exports.js"));
  await copyFile(join(repoPath, "scripts", "mock-aws-exports-es5.js"), join(repoPath, "aws-exports-es5.js"));
  await copyFile(join(repoPath, "data", "database-seed.json"), join(repoPath, "data", "database.json"));
}

function isTargetInstallComplete(repoPath: string): boolean {
  return [
    join(repoPath, "node_modules", "ts-node", "dist", "bin.js"),
    join(repoPath, "node_modules", "vite", "bin", "vite.js"),
    join(repoPath, "node_modules", "patch-package", "index.js"),
    join(repoPath, "node_modules", "@mui", "icons-material", "package.json"),
  ].every((path) => existsSync(path));
}

async function runPatchPackage(repoPath: string, runtime: TargetRuntime): Promise<void> {
  const localPatchPackage = join(repoPath, "node_modules", "patch-package", "index.js");

  if (existsSync(localPatchPackage)) {
    await runCommand(runtime.node, [localPatchPackage], {
      cwd: repoPath,
      env: runtime.env,
      timeoutMs: 300_000,
    });
    return;
  }

  await runCommand(runtime.npx.command, [...runtime.npx.args, "patch-package"], {
    cwd: repoPath,
    env: runtime.env,
    timeoutMs: 300_000,
  });
}

function spawnDetached(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdoutPath: string;
    stderrPath: string;
  },
): number {
  const stdout = openSync(options.stdoutPath, "a");
  const stderr = openSync(options.stderrPath, "a");

  try {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      shell: false,
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    });

    if (!child.pid) {
      throw new Error(`Failed to start ${command}.`);
    }

    child.on("error", () => undefined);
    child.unref();
    return child.pid;
  }
  finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function addProcessId(processIds: Set<number>, processId: number | undefined): void {
  if (typeof processId === "number" && Number.isInteger(processId) && processId > 0) {
    processIds.add(processId);
  }
}

async function stopProcessTree(processId: number): Promise<boolean> {
  if (process.platform === "win32") {
    const result = await runCommand("taskkill", ["/PID", String(processId), "/T", "/F"], {
      rejectOnFailure: false,
      timeoutMs: 30_000,
    });
    return result.exitCode === 0;
  }

  try {
    process.kill(-processId, "SIGTERM");
    return true;
  }
  catch {
    try {
      process.kill(processId, "SIGTERM");
      return true;
    }
    catch {
      return false;
    }
  }
}

function waitForTcpPort(port: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();

  return new Promise((resolvePromise) => {
    const attempt = (): void => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const finish = (ready: boolean): void => {
        socket.removeAllListeners();
        socket.destroy();

        if (ready) {
          resolvePromise(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolvePromise(false);
          return;
        }

        setTimeout(attempt, 2_000);
      };

      socket.setTimeout(1_000);
      socket.on("connect", () => finish(true));
      socket.on("timeout", () => finish(false));
      socket.on("error", () => finish(false));
    };

    attempt();
  });
}

function waitForHttpOk(url: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();

  return new Promise((resolvePromise) => {
    const attempt = (): void => {
      const request = http.get(url, { timeout: 5_000 }, (response) => {
        response.resume();
        if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 500) {
          resolvePromise(true);
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
        resolvePromise(false);
        return;
      }

      setTimeout(attempt, 3_000);
    };

    attempt();
  });
}

function withPathPrefix(prefix: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    PATH: `${prefix}${delimiter}${process.env.PATH ?? ""}`,
  };
}
