import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { runCommand } from "./targets/command.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

/**
 * Model-authored patch pipeline.
 *
 * The proof boundary stays the same: the deterministic verifier decides
 * acceptance. This module's job is only to give the verifier a model-
 * authored candidate diff to evaluate, alongside the fixture diff.
 *
 * Flow:
 *   1. Restore the target repo to a clean state.
 *   2. Spawn a Claude Code agent loop in the target repo with file-edit
 *      tools (Read, Edit, Write, Glob, Grep, Bash).
 *   3. Capture the full transcript: turns, tool calls, tool results,
 *      assistant text, final result, token usage, cost.
 *   4. After the agent finishes, capture the diff via `git diff`.
 *   5. Reset the target repo back to clean.
 *   6. Persist `model-patch.diff` and `model-agent-trace.json` next to
 *      the regular per-case artifacts.
 *
 * The fixture pipeline is never disturbed. If the agent fails, we still
 * write a transcript with the failure reason so the cockpit can show
 * what was attempted.
 */

export type ModelPatchTurn = {
  turnIndex: number;
  assistantUuid: string;
  textBlocks: string[];
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    result?: string;
    isError?: boolean;
  }>;
};

export type ModelPatchTrace = {
  caseId: string;
  generatedAt: string;
  status: "success" | "no-changes" | "agent-error" | "sdk-unavailable" | "no-api-key";
  provider: "claude-agent-sdk";
  liveModelUsed: boolean;
  model?: string;
  sessionId?: string;
  loadedTools?: string[];
  workingDirectory: string;
  turns: ModelPatchTurn[];
  totalTurns: number;
  totalToolCalls: number;
  filesRead: string[];
  filesEdited: string[];
  finalAssistantText: string;
  resultSubtype?: string;
  durationMs?: number;
  durationApiMs?: number;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  errors?: string[];
  permissionDenials?: Array<{
    toolName: string;
    toolInput: Record<string, unknown>;
  }>;
  patchPath?: string;
  patchByteLength?: number;
  truthBoundary: string;
  recordedRunNote: string;
};

export type ModelPatchResult = {
  trace: ModelPatchTrace;
  tracePath: string;
  patchPath?: string;
};

export type RunModelPatchOptions = {
  /**
   * Absolute path to the cloned target repo. The agent runs `cwd` here.
   * For CRWA this is `.surgeon-targets/cypress-realworld-app`.
   */
  targetRepoPath: string;
  /**
   * Maximum number of agent turns. Defaults to 25.
   */
  maxTurns?: number;
  /**
   * Optional override of the model. Defaults to env or claude-opus-4-7.
   */
  model?: string;
  /**
   * Optional ABORTcontroller for early cancellation.
   */
  abortController?: AbortController;
};

const DEFAULT_MAX_TURNS = 25;
const DEFAULT_MODEL = "claude-opus-4-7";

/**
 * Run the model-patch agent and persist the trace + diff.
 *
 * Always returns a trace object, even on failure. Never throws.
 */
export async function runModelPatchAgent(
  caseFile: CaseFile,
  options: RunModelPatchOptions,
): Promise<ModelPatchResult> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const tracePath = resolve(artifactDirectory, "model-agent-trace.json");
  const traceMdPath = resolve(artifactDirectory, "model-agent-trace.md");
  const patchPath = resolve(artifactDirectory, "model-patch.diff");
  const targetRepoPath = resolve(options.targetRepoPath);

  await mkdir(artifactDirectory, { recursive: true });

  if (!process.env.ANTHROPIC_API_KEY) {
    const trace = buildEmptyTrace(caseFile, targetRepoPath, "no-api-key", {
      recordedRunNote:
        "Model-authored patch was skipped because ANTHROPIC_API_KEY was not set. The fixture pipeline still produced a verified scorecard.",
    });
    await persistTrace(tracePath, traceMdPath, trace);
    return { trace, tracePath };
  }

  let sdk: typeof import("@anthropic-ai/claude-agent-sdk") | undefined;
  try {
    sdk = await import("@anthropic-ai/claude-agent-sdk");
  }
  catch (error) {
    const trace = buildEmptyTrace(caseFile, targetRepoPath, "sdk-unavailable", {
      recordedRunNote:
        "The @anthropic-ai/claude-agent-sdk package could not be loaded. The fixture pipeline still produced a verified scorecard.",
      errors: [
        error instanceof Error ? error.message : String(error),
      ],
    });
    await persistTrace(tracePath, traceMdPath, trace);
    return { trace, tracePath };
  }

  if (!existsSync(targetRepoPath)) {
    const trace = buildEmptyTrace(caseFile, targetRepoPath, "agent-error", {
      recordedRunNote: `Target repo not found at ${targetRepoPath}. Run pnpm surgeon target setup first.`,
      errors: [`Missing target repo at ${targetRepoPath}.`],
    });
    await persistTrace(tracePath, traceMdPath, trace);
    return { trace, tracePath };
  }

  // Reset target repo before running the agent.
  await resetTargetRepo(targetRepoPath);

  // Read evidence summaries for the prompt.
  const candidatesText = await readOptionalText(manifest.files.candidates);
  const consoleSummary = await summarizeConsoleEvidence(manifest.files.console);
  const topCandidates = parseTopCandidates(candidatesText, 5);
  const assertionList = caseFile.verification.assertions ?? [];
  const expectedFailures = caseFile.verification.negativeControl?.expectedFailures ?? [];

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    caseFile,
    topCandidates,
    consoleSummary,
    assertionList,
    expectedFailures,
    targetRepoPath,
  });

  const trace: ModelPatchTrace = buildEmptyTrace(caseFile, targetRepoPath, "success", {
    recordedRunNote:
      "Model-authored patch produced by Claude Code agent loop running inside the target repository. The deterministic verifier evaluates this candidate alongside the fixture patch.",
  });

  const toolCallById = new Map<string, ModelPatchTurn["toolCalls"][number]>();
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  const assistantTexts: string[] = [];
  const abortController = options.abortController ?? new AbortController();

  try {
    const queryGenerator = sdk.query({
      prompt: userPrompt,
      options: {
        cwd: targetRepoPath,
        systemPrompt,
        tools: { type: "preset" as const, preset: "claude_code" as const },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        // Hard-block external network access. The agent must use local files only.
        disallowedTools: ["WebFetch", "WebSearch"],
        settingSources: [],
        maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
        includePartialMessages: false,
        model: options.model ?? process.env.SURGEON_REASONER_MODEL ?? DEFAULT_MODEL,
        abortController,
        env: {
          ...process.env,
          // Make sure the spawned CLI sees the API key.
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
      },
    });

    let turnIndex = 0;
    let currentTurn: ModelPatchTurn | undefined;

    for await (const message of queryGenerator) {
      switch (message.type) {
        case "system": {
          if ("subtype" in message && message.subtype === "init") {
            const initMessage = message as unknown as { session_id?: string; model?: string; tools?: string[] };
            trace.sessionId = initMessage.session_id;
            trace.model = initMessage.model;
            trace.loadedTools = initMessage.tools;
          }
          break;
        }

        case "assistant": {
          turnIndex += 1;
          // Cast through unknown because the SDK's BetaContentBlock union is
          // narrower than the runtime shape we walk; we only access fields
          // we have already verified exist on the relevant variants.
          const blocks = message as unknown as { message: { content: Array<Record<string, unknown>> }; uuid: string };
          const turn: ModelPatchTurn = {
            turnIndex,
            assistantUuid: blocks.uuid,
            textBlocks: [],
            toolCalls: [],
          };
          for (const block of blocks.message.content) {
            const blockType = block["type"] as string;
            if (blockType === "text") {
              const textValue = String(block["text"] ?? "");
              turn.textBlocks.push(textValue);
              assistantTexts.push(textValue);
            }
            else if (blockType === "tool_use") {
              const toolCall = {
                id: String(block["id"] ?? ""),
                name: String(block["name"] ?? ""),
                input: (block["input"] as Record<string, unknown>) ?? {},
              };
              turn.toolCalls.push(toolCall);
              toolCallById.set(toolCall.id, toolCall as ModelPatchTurn["toolCalls"][number]);
              recordFileTouch(toolCall.name, toolCall.input, filesRead, filesEdited);
            }
          }
          currentTurn = turn;
          trace.turns.push(turn);
          break;
        }

        case "user": {
          const userMessage = message as unknown as { message: { content: unknown } };
          const content = userMessage.message.content;
          if (Array.isArray(content)) {
            for (const block of content as Array<Record<string, unknown>>) {
              if (block["type"] === "tool_result") {
                const toolUseId = String(block["tool_use_id"] ?? "");
                const call = toolCallById.get(toolUseId);
                if (!call) continue;
                call.isError = Boolean(block["is_error"]);
                call.result = stringifyToolResult(block["content"]);
              }
            }
          }
          break;
        }

        case "result": {
          const resultMessage = message as unknown as {
            subtype: string;
            duration_ms?: number;
            duration_api_ms?: number;
            total_cost_usd?: number;
            num_turns?: number;
            usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
            permission_denials?: Array<{ tool_name: string; tool_input: Record<string, unknown> }>;
            errors?: string[];
            result?: string;
          };
          trace.resultSubtype = resultMessage.subtype;
          trace.durationMs = resultMessage.duration_ms;
          trace.durationApiMs = resultMessage.duration_api_ms;
          trace.totalCostUsd = resultMessage.total_cost_usd;
          trace.inputTokens = resultMessage.usage?.input_tokens;
          trace.outputTokens = resultMessage.usage?.output_tokens;
          trace.cacheReadInputTokens = resultMessage.usage?.cache_read_input_tokens;
          trace.cacheCreationInputTokens = resultMessage.usage?.cache_creation_input_tokens;
          if (resultMessage.permission_denials && resultMessage.permission_denials.length > 0) {
            trace.permissionDenials = resultMessage.permission_denials.map((denial) => ({
              toolName: denial.tool_name,
              toolInput: denial.tool_input ?? {},
            }));
          }
          if (resultMessage.subtype === "success" && resultMessage.result) {
            trace.finalAssistantText = resultMessage.result;
          }
          else if (resultMessage.errors && resultMessage.errors.length > 0) {
            trace.errors = resultMessage.errors;
          }
          break;
        }

        default:
          break;
      }
    }

    if (!trace.finalAssistantText) {
      trace.finalAssistantText = assistantTexts.length > 0 ? assistantTexts[assistantTexts.length - 1] : "";
    }

    void currentTurn;
  }
  catch (error) {
    trace.status = "agent-error";
    trace.errors = [
      ...(trace.errors ?? []),
      error instanceof Error ? error.message : String(error),
    ];
  }

  trace.totalTurns = trace.turns.length;
  trace.totalToolCalls = trace.turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0);
  trace.filesRead = [...filesRead];
  trace.filesEdited = [...filesEdited];

  // Capture the diff the agent produced. We use a custom spawn here so we
  // can preserve stdout exactly (no whitespace trimming, no stderr mixing).
  let producedPatch = false;
  try {
    const diffStdout = await captureGitDiffStdout(targetRepoPath);
    if (diffStdout.trim().length > 0) {
      await writeFile(patchPath, diffStdout, "utf8");
      trace.patchPath = patchPath;
      trace.patchByteLength = Buffer.byteLength(diffStdout, "utf8");
      producedPatch = true;
    }
  }
  catch (error) {
    trace.errors = [
      ...(trace.errors ?? []),
      `Failed to capture git diff: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  // Always reset the target repo so subsequent runs are deterministic.
  await resetTargetRepo(targetRepoPath);

  if (!producedPatch && trace.status === "success") {
    trace.status = "no-changes";
    trace.recordedRunNote =
      "The agent finished without writing any file changes the verifier could evaluate. The fixture pipeline still produced a verified scorecard.";
  }

  await persistTrace(tracePath, traceMdPath, trace);
  return { trace, tracePath, patchPath: producedPatch ? patchPath : undefined };
}

async function persistTrace(
  tracePath: string,
  traceMdPath: string,
  trace: ModelPatchTrace,
): Promise<void> {
  await mkdir(dirname(tracePath), { recursive: true });
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  await writeFile(traceMdPath, renderTraceMarkdown(trace), "utf8");
}

function buildEmptyTrace(
  caseFile: CaseFile,
  targetRepoPath: string,
  status: ModelPatchTrace["status"],
  overrides: Partial<ModelPatchTrace> = {},
): ModelPatchTrace {
  return {
    caseId: caseFile.id,
    generatedAt: new Date().toISOString(),
    status,
    provider: "claude-agent-sdk",
    liveModelUsed: status === "success",
    workingDirectory: targetRepoPath,
    turns: [],
    totalTurns: 0,
    totalToolCalls: 0,
    filesRead: [],
    filesEdited: [],
    finalAssistantText: "",
    truthBoundary:
      "The agent proposes a candidate patch. The deterministic verifier evaluates it against the same gates as the fixture patch.",
    recordedRunNote:
      "Model-authored patch produced by Claude Code agent loop. The verifier decides acceptance.",
    ...overrides,
  };
}

function buildSystemPrompt(): {
  type: "preset";
  preset: "claude_code";
  append: string;
} {
  return {
    type: "preset",
    preset: "claude_code",
    append: [
      "You are a focused frontend bug-fix agent operating inside a target repository.",
      "Your job: read the bug context, examine 1-3 candidate files, and apply the SMALLEST possible code change that fixes the layout / UI bug described.",
      "Do NOT write tests. Do NOT refactor. Do NOT touch unrelated files.",
      "Prefer Read, Glob, and Grep before Edit. Use Edit for precise replacements; Write only if the file does not exist.",
      "Constraints:",
      "- Only edit files inside the target repository's source tree (typically `src/`).",
      "- Avoid backend/, tests/, e2e/, cypress/, scripts/, and node_modules/.",
      "- Make a focused, minimal diff. The verifier will run automated browser assertions to decide if your change fixes the bug.",
      "- Do not run `npm install`, `npm test`, dev servers, or any long-running command. The harness already manages the dev server.",
      "- Do not run `git add`, `git commit`, `git stash`, `git reset`, or `git checkout` — leave the working tree dirty so the harness can capture your diff.",
      "When you are done, end with one short paragraph summarizing the file you edited and the smallest reason the fix should pass the verifier.",
    ].join("\n"),
  };
}

function buildUserPrompt(input: {
  caseFile: CaseFile;
  topCandidates: Array<{ relativeFile: string; score: number; reasons: string[] }>;
  consoleSummary: { warningCount: number; errorCount: number; examples: string[] };
  assertionList: NonNullable<CaseFile["verification"]["assertions"]>;
  expectedFailures: string[];
  targetRepoPath: string;
}): string {
  const { caseFile, topCandidates, consoleSummary, assertionList, expectedFailures, targetRepoPath } = input;

  const lines: string[] = [
    `Bug case: ${caseFile.title}`,
    `Case id: ${caseFile.id}`,
    `Route under test: ${caseFile.route}`,
    `Viewport: ${caseFile.viewport.name} (${caseFile.viewport.width}x${caseFile.viewport.height}, mobile=${caseFile.viewport.isMobile ? "yes" : "no"})`,
    `Stack: ${caseFile.target.stack}`,
    `Working directory (target repo): ${targetRepoPath}`,
    "",
    "Bug description:",
    caseFile.input.note,
    "",
    "Reproduction steps the verifier already used to capture failure evidence:",
    ...caseFile.repro.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Top source candidates ranked by deterministic localizer:",
    ...topCandidates.map((candidate, index) =>
      `${index + 1}. ${candidate.relativeFile} (score ${candidate.score}) — ${candidate.reasons.slice(0, 3).join("; ")}`,
    ),
    "",
    "Console summary captured during the failing reproduction:",
    `- warnings: ${consoleSummary.warningCount}`,
    `- errors: ${consoleSummary.errorCount}`,
    ...consoleSummary.examples.map((example) => `- ${example}`),
    "",
    "Verifier assertions that must PASS after your fix:",
  ];

  for (const assertion of assertionList) {
    if (assertion.type === "visible") {
      lines.push(`- visible: \`${assertion.selector}\` must render and be visible`);
    }
    else if (assertion.type === "insideViewport") {
      lines.push(`- insideViewport: \`${assertion.selector}\` must stay inside the ${caseFile.viewport.width}x${caseFile.viewport.height} viewport`);
    }
    else if (assertion.type === "topWithin") {
      lines.push(`- topWithin: \`${assertion.selector}\` must have its top within ${assertion.maxY}px from the top`);
    }
    else if (assertion.type === "widthAtLeast") {
      lines.push(`- widthAtLeast: \`${assertion.selector}\` must be at least ${assertion.minWidth}px wide`);
    }
    else if (assertion.type === "noOverlap") {
      lines.push(`- noOverlap: \`${assertion.targetSelector}\` must not overlap \`${assertion.blockerSelector}\``);
    }
    else if (assertion.type === "noHorizontalOverflow") {
      lines.push("- noHorizontalOverflow: page must not scroll horizontally");
    }
    else if (assertion.type === "noConsoleRegression") {
      lines.push("- noConsoleRegression: do not introduce new console errors");
    }
  }

  if (expectedFailures.length > 0) {
    lines.push(
      "",
      "These assertions FAIL today, before your fix (they are the negative control):",
      ...expectedFailures.map((failure) => `- ${failure}`),
    );
  }

  lines.push(
    "",
    "Your task:",
    "1. Use Read / Glob / Grep to understand the top candidate file(s).",
    "2. Make the SMALLEST possible Edit that you believe will satisfy the assertions above.",
    "3. Briefly summarize what you changed and why it should make the assertions pass.",
    "",
    "Important:",
    "- The verifier runs after you finish — do not run the dev server or tests yourself.",
    "- Leave your file changes uncommitted in the working tree. The harness will capture them via `git diff`.",
    "- Do not edit tests, cypress files, or backend files. Restrict edits to component / style code in `src/`.",
  );

  return lines.join("\n");
}

function recordFileTouch(
  toolName: string,
  input: Record<string, unknown>,
  reads: Set<string>,
  edits: Set<string>,
): void {
  const path = typeof input.file_path === "string" ? input.file_path : undefined;
  if (!path) return;
  const normalized = path.replace(/\\/g, "/");
  if (toolName === "Read") {
    reads.add(normalized);
  }
  else if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") {
    edits.add(normalized);
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") {
    return content.length > 4000 ? `${content.slice(0, 4000)}\n... (truncated)` : content;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
      .map((block) => String((block as { text?: string }).text ?? ""))
      .join("\n");
    return text.length > 4000 ? `${text.slice(0, 4000)}\n... (truncated)` : text;
  }
  return "";
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  }
  catch {
    return "";
  }
}

async function summarizeConsoleEvidence(consolePath: string): Promise<{
  warningCount: number;
  errorCount: number;
  examples: string[];
}> {
  const text = await readOptionalText(consolePath);
  if (!text) {
    return { warningCount: 0, errorCount: 0, examples: [] };
  }
  const records = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { type?: string; text?: string };
      }
      catch {
        return undefined;
      }
    })
    .filter((record): record is { type?: string; text?: string } => Boolean(record));

  const warnings = records.filter((record) => record.type === "warning");
  const errors = records.filter((record) => record.type === "error");
  const examples = [...warnings, ...errors]
    .slice(0, 4)
    .map((record) => truncateOneLine(record.text ?? "unknown console event", 180));

  return {
    warningCount: warnings.length,
    errorCount: errors.length,
    examples,
  };
}

function parseTopCandidates(
  candidatesText: string,
  limit: number,
): Array<{ relativeFile: string; score: number; reasons: string[] }> {
  if (!candidatesText) return [];
  try {
    const parsed = JSON.parse(candidatesText) as {
      candidates?: Array<{ relativeFile?: string; score?: number; reasons?: string[] }>;
    };
    const list = parsed.candidates ?? [];
    return list.slice(0, limit).map((candidate) => ({
      relativeFile: candidate.relativeFile ?? "unknown",
      score: typeof candidate.score === "number" ? candidate.score : 0,
      reasons: Array.isArray(candidate.reasons) ? candidate.reasons.map((reason) => String(reason)) : [],
    }));
  }
  catch {
    return [];
  }
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function resetTargetRepo(repoPath: string): Promise<void> {
  await runCommand("git", ["-C", repoPath, "reset", "--hard", "HEAD"], { rejectOnFailure: false, captureOutput: true });
  await runCommand("git", ["-C", repoPath, "clean", "-fdx", "--exclude=node_modules", "--exclude=.surgeon-targets"], { rejectOnFailure: false, captureOutput: true });
}

/**
 * Capture `git diff` stdout exactly. We avoid the shared runCommand helper
 * here because it trims whitespace and mixes stderr into the same buffer,
 * neither of which is safe for a unified diff that may end with a context
 * line and an LF, and that may have legitimate stderr noise from the agent's
 * earlier git commands echoed by certain platforms.
 */
async function captureGitDiffStdout(repoPath: string): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["-C", repoPath, "diff", "--no-color", "--no-ext-diff"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.on("error", (error) => rejectPromise(error));
    child.on("close", () => {
      resolvePromise(Buffer.concat(stdoutChunks).toString("utf8"));
    });
  });
}

function renderTraceMarkdown(trace: ModelPatchTrace): string {
  const lines: string[] = [
    "# Model Authorship Transcript",
    "",
    `Case: \`${trace.caseId}\``,
    `Provider: \`${trace.provider}\``,
    `Live model used: \`${trace.liveModelUsed ? "yes" : "no"}\``,
    `Status: \`${trace.status}\``,
    `Model: \`${trace.model ?? "n/a"}\``,
    `Session id: \`${trace.sessionId ?? "n/a"}\``,
    `Total turns: \`${trace.totalTurns}\``,
    `Total tool calls: \`${trace.totalToolCalls}\``,
    `Files read: \`${trace.filesRead.length}\``,
    `Files edited: \`${trace.filesEdited.length}\``,
    `Patch size: \`${trace.patchByteLength ?? 0} bytes\``,
    `Duration: \`${trace.durationMs ?? "n/a"}ms\``,
    `Total cost: \`USD ${typeof trace.totalCostUsd === "number" ? trace.totalCostUsd.toFixed(4) : "n/a"}\``,
    `Input tokens: \`${trace.inputTokens ?? "n/a"}\``,
    `Output tokens: \`${trace.outputTokens ?? "n/a"}\``,
    "",
    "## Truth Boundary",
    "",
    trace.truthBoundary,
    "",
    "## Recorded Run Note",
    "",
    trace.recordedRunNote,
    "",
  ];

  if (trace.errors && trace.errors.length > 0) {
    lines.push("## Errors", "", ...trace.errors.map((error) => `- ${error}`), "");
  }

  if (trace.permissionDenials && trace.permissionDenials.length > 0) {
    lines.push("## Permission Denials", "");
    for (const denial of trace.permissionDenials) {
      lines.push(`- \`${denial.toolName}\` was denied`);
    }
    lines.push("");
  }

  if (trace.filesRead.length > 0) {
    lines.push("## Files Read", "", ...trace.filesRead.map((path) => `- \`${path}\``), "");
  }

  if (trace.filesEdited.length > 0) {
    lines.push("## Files Edited", "", ...trace.filesEdited.map((path) => `- \`${path}\``), "");
  }

  if (trace.finalAssistantText) {
    lines.push("## Final Assistant Text", "", trace.finalAssistantText, "");
  }

  lines.push("## Turn Timeline", "");
  for (const turn of trace.turns) {
    lines.push(`### Turn ${turn.turnIndex}`, "");
    if (turn.textBlocks.length > 0) {
      lines.push(turn.textBlocks.join("\n\n"), "");
    }
    for (const call of turn.toolCalls) {
      const errorTag = call.isError ? " (error)" : "";
      lines.push(`- tool: \`${call.name}\`${errorTag}`);
      if (call.input.file_path) {
        lines.push(`  - file: \`${String(call.input.file_path).replace(/\\/g, "/")}\``);
      }
      if (typeof call.input.command === "string") {
        lines.push(`  - command: \`${truncateOneLine(call.input.command, 200)}\``);
      }
      if (typeof call.input.pattern === "string") {
        lines.push(`  - pattern: \`${truncateOneLine(call.input.pattern, 200)}\``);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
