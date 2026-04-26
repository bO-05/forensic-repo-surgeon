import { spawn } from "node:child_process";

export type CommandResult = {
  detail: string;
  exitCode: number;
};

export async function runCommand(
  command: string,
  args: string[],
  options: {
    captureOutput?: boolean;
    rejectOnFailure?: boolean;
    timeoutMs?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CommandResult> {
  const captureOutput = options.captureOutput ?? true;
  const rejectOnFailure = options.rejectOnFailure ?? true;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(resolveExecutable(command), args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      shell: false,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            if (settled) {
              return;
            }

            settled = true;
            child.kill("SIGKILL");
            rejectPromise(new Error(`${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs);

    if (captureOutput) {
      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    }

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      rejectPromise(error);
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }

      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      const detail = [output, errorOutput].filter(Boolean).join("\n");
      const result = {
        detail,
        exitCode: exitCode ?? 0,
      };

      if (rejectOnFailure && exitCode !== 0) {
        rejectPromise(
          new Error(`${command} ${args.join(" ")} failed with exit code ${exitCode}:\n${detail}`),
        );
        return;
      }

      resolvePromise(result);
    });
  });
}

export function resolveExecutable(command: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") {
    return command;
  }

  if (["npm", "npx", "pnpm", "yarn"].includes(command)) {
    return `${command}.cmd`;
  }

  return command;
}
