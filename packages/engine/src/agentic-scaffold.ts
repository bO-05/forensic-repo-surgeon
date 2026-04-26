import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Live agentic scaffolder.
 *
 * The previous `--agentic` flag emitted a regex over the user's verb prefix.
 * That is honest as a stub but does not actually use a model. This module
 * provides a Claude Code agent loop (via @anthropic-ai/claude-agent-sdk)
 * that drafts the Playwright workflow from a bug description, optional
 * screenshot, and optional set of repro steps.
 *
 * The live path runs only when ANTHROPIC_API_KEY is set. Without a key,
 * we return undefined so the caller can fall back to the regex heuristic.
 *
 * The agent's deliverable is not proof. The case is still draft until
 * `before-verify.json`, `verify.json`, and `scorecard.json` show the bug
 * fails before the patch and passes after it.
 */

export type LiveScaffoldOptions = {
  id: string;
  bugText?: string;
  screenshotPath?: string;
  baseUrl?: string;
  route?: string;
  viewport: "mobile" | "desktop";
  steps?: string[];
  visibleSelector?: string;
  expectedFailures?: string[];
  /**
   * Working directory for the agent. Defaults to the repository root.
   * The screenshot path, if relative, is resolved against this directory.
   */
  cwd?: string;
  /**
   * Override max turns. Defaults to 8.
   */
  maxTurns?: number;
  /**
   * Override model. Defaults to env or claude-opus-4-7.
   */
  model?: string;
};

export type LiveScaffoldResult = {
  workflowBody: string;
  confidence: "draft" | "low" | "medium" | "high";
  assumptions: string[];
  generatedActions: Array<{ step: string; action: string }>;
  recommendedSelectors: string[];
  notes: string[];
  transcript: {
    provider: "claude-agent-sdk";
    sessionId?: string;
    model?: string;
    totalTurns: number;
    totalToolCalls: number;
    durationMs?: number;
    totalCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    finalAssistantText: string;
    filesRead: string[];
    rawResponse: string;
  };
};

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_MODEL = "claude-opus-4-7";

/**
 * Run the live agentic scaffolder.
 *
 * Returns undefined (so the caller can fall back) when:
 *   - ANTHROPIC_API_KEY is not set, OR
 *   - the SDK can't be loaded, OR
 *   - the agent fails to produce a usable workflow body.
 *
 * Never throws.
 */
export async function runLiveAgenticScaffold(
  options: LiveScaffoldOptions,
): Promise<LiveScaffoldResult | undefined> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return undefined;
  }

  let sdk: typeof import("@anthropic-ai/claude-agent-sdk") | undefined;
  try {
    sdk = await import("@anthropic-ai/claude-agent-sdk");
  }
  catch {
    return undefined;
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotResolved = options.screenshotPath
    ? resolve(cwd, options.screenshotPath)
    : undefined;
  const screenshotExists = screenshotResolved ? existsSync(screenshotResolved) : false;

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    ...options,
    screenshotPath: screenshotResolved,
    screenshotExists,
  });

  const filesRead: string[] = [];
  const assistantTexts: string[] = [];
  let totalTurns = 0;
  let totalToolCalls = 0;
  let sessionId: string | undefined;
  let model: string | undefined;
  let durationMs: number | undefined;
  let totalCostUsd: number | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finalAssistantText = "";

  try {
    const queryGenerator = sdk.query({
      prompt: userPrompt,
      options: {
        cwd,
        systemPrompt,
        // Allow Read for the screenshot, plus Glob/Grep for context. No Edit/Write.
        // The agent must respond with the workflow as plain JSON in its final text.
        tools: ["Read", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        disallowedTools: ["WebFetch", "WebSearch", "Bash", "Edit", "Write", "NotebookEdit"],
        settingSources: [],
        maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
        includePartialMessages: false,
        model: options.model ?? process.env.SURGEON_REASONER_MODEL ?? DEFAULT_MODEL,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
      },
    });

    for await (const message of queryGenerator) {
      switch (message.type) {
        case "system": {
          if ("subtype" in message && message.subtype === "init") {
            const initMessage = message as unknown as { session_id?: string; model?: string };
            sessionId = initMessage.session_id;
            model = initMessage.model;
          }
          break;
        }
        case "assistant": {
          totalTurns += 1;
          const blocks = message as unknown as { message: { content: Array<Record<string, unknown>> } };
          for (const block of blocks.message.content) {
            const blockType = block["type"] as string;
            if (blockType === "text") {
              const text = String(block["text"] ?? "");
              assistantTexts.push(text);
            }
            else if (blockType === "tool_use") {
              totalToolCalls += 1;
              const name = String(block["name"] ?? "");
              const input = (block["input"] as Record<string, unknown>) ?? {};
              if (name === "Read" && typeof input.file_path === "string") {
                filesRead.push(input.file_path.replace(/\\/g, "/"));
              }
            }
          }
          break;
        }
        case "result": {
          const resultMessage = message as unknown as {
            subtype: string;
            duration_ms?: number;
            total_cost_usd?: number;
            usage?: { input_tokens?: number; output_tokens?: number };
            result?: string;
          };
          durationMs = resultMessage.duration_ms;
          totalCostUsd = resultMessage.total_cost_usd;
          inputTokens = resultMessage.usage?.input_tokens;
          outputTokens = resultMessage.usage?.output_tokens;
          if (resultMessage.subtype === "success" && resultMessage.result) {
            finalAssistantText = resultMessage.result;
          }
          break;
        }
        default:
          break;
      }
    }
  }
  catch {
    return undefined;
  }

  if (!finalAssistantText) {
    finalAssistantText = assistantTexts.length > 0 ? assistantTexts[assistantTexts.length - 1] : "";
  }

  if (!finalAssistantText) {
    return undefined;
  }

  const parsed = parseScaffoldJson(finalAssistantText);
  if (!parsed || !parsed.workflowBody) {
    return undefined;
  }

  return {
    workflowBody: parsed.workflowBody,
    confidence: normalizeConfidence(parsed.confidence),
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.slice(0, 12) : [],
    generatedActions: Array.isArray(parsed.generatedActions)
      ? parsed.generatedActions
          .slice(0, 24)
          .map((entry) => ({
            step: typeof entry.step === "string" ? entry.step : "",
            action: typeof entry.action === "string" ? entry.action : "",
          }))
          .filter((entry) => entry.step && entry.action)
      : [],
    recommendedSelectors: Array.isArray(parsed.recommendedSelectors)
      ? parsed.recommendedSelectors.slice(0, 12).map((value) => String(value))
      : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 12).map((value) => String(value)) : [],
    transcript: {
      provider: "claude-agent-sdk",
      sessionId,
      model,
      totalTurns,
      totalToolCalls,
      durationMs,
      totalCostUsd,
      inputTokens,
      outputTokens,
      finalAssistantText,
      filesRead,
      rawResponse: finalAssistantText,
    },
  };
}

/**
 * Persist the scaffolder's transcript next to the case files. Useful for
 * the demo cockpit and for honest disclosure of model authorship.
 */
export async function persistAgenticScaffoldTranscript(
  outDir: string,
  caseId: string,
  result: LiveScaffoldResult,
): Promise<string> {
  const path = resolve(outDir, `${caseId}.scaffold-trace.json`);
  await mkdir(dirname(path), { recursive: true });
  const payload = {
    caseId,
    generatedAt: new Date().toISOString(),
    truthBoundary:
      "The agent drafts a candidate Playwright workflow. The case is not proof until before-verify.json and verify.json show the bug fails before the patch and passes after it.",
    ...result.transcript,
    confidence: result.confidence,
    assumptions: result.assumptions,
    generatedActions: result.generatedActions,
    recommendedSelectors: result.recommendedSelectors,
    notes: result.notes,
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
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
      "You are a Playwright workflow drafter for a frontend bug reproduction harness.",
      "Your only deliverable is a JSON object describing a draft workflow. Do not run shell commands. Do not edit files. Do not write tests.",
      "If a screenshot path is provided AND the file exists, you MAY use the Read tool once to inspect it. Otherwise, do not call any tools.",
      "Output requirements:",
      "- Respond with a single JSON object, optionally wrapped in a fenced ```json``` block.",
      "- The object MUST have a `workflowBody` string containing the BODY of an async function `runWorkflow(page, caseFile)` (no function signature, no surrounding braces, no imports).",
      "- Inside `workflowBody`, only use Playwright `page` APIs already imported by the harness: `page.goto`, `page.locator`, `page.getByRole`, `page.getByText`, `page.waitForSelector`, `page.click`, etc.",
      "- The harness already calls `page.goto` and waits for `body` before calling your workflow. Start AFTER navigation.",
      "- Prefer `data-test=\"...\"` selectors when likely; otherwise prefer roles, then visible text. Avoid brittle CSS selectors.",
      "- The workflow's purpose is ONLY to reach the failing UI state. Do not assert anything; the harness runs deterministic assertions afterward.",
      "- Include `confidence` (one of `draft`, `low`, `medium`, `high`), `assumptions` (string[]), `generatedActions` ({step, action}[]), `recommendedSelectors` (string[]), and `notes` (string[]).",
      "- Be concise. Workflows under 30 lines are preferred.",
      "Truth boundary: this is a draft, not proof. The harness's deterministic verifier decides acceptance.",
    ].join("\n"),
  };
}

function buildUserPrompt(input: {
  id: string;
  bugText?: string;
  screenshotPath?: string;
  screenshotExists: boolean;
  baseUrl?: string;
  route?: string;
  viewport: "mobile" | "desktop";
  steps?: string[];
  visibleSelector?: string;
  expectedFailures?: string[];
}): string {
  const lines: string[] = [
    `Case id: ${input.id}`,
    `Bug description: ${input.bugText ?? "(not provided)"}`,
    `Base URL: ${input.baseUrl ?? "(not provided)"}`,
    `Route: ${input.route ?? "/"}`,
    `Viewport: ${input.viewport}`,
  ];

  if (input.screenshotPath) {
    lines.push(`Screenshot path: ${input.screenshotPath}`);
    if (input.screenshotExists) {
      lines.push("- The screenshot file exists. You may use the Read tool ONCE to inspect it.");
    }
    else {
      lines.push("- The screenshot file does NOT exist on disk. Do not attempt to read it.");
    }
  }

  if (input.steps && input.steps.length > 0) {
    lines.push("", "Repro steps supplied at scaffold time:");
    for (const step of input.steps) {
      lines.push(`- ${step}`);
    }
  }

  if (input.visibleSelector) {
    lines.push("", `Primary visible selector hint: ${input.visibleSelector}`);
  }

  if (input.expectedFailures && input.expectedFailures.length > 0) {
    lines.push("", "Assertions expected to FAIL before the patch:");
    for (const failure of input.expectedFailures) {
      lines.push(`- ${failure}`);
    }
  }

  lines.push(
    "",
    "Your task: draft the smallest Playwright workflow that reaches this failing UI state.",
    "Respond ONLY with the JSON object described in the system prompt.",
  );

  return lines.join("\n");
}

function parseScaffoldJson(text: string): {
  workflowBody?: string;
  confidence?: string;
  assumptions?: unknown;
  generatedActions?: Array<{ step?: unknown; action?: unknown }>;
  recommendedSelectors?: unknown;
  notes?: unknown;
} | undefined {
  if (!text) return undefined;

  // Try fenced JSON first.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu);
  const candidates = [
    fenceMatch ? fenceMatch[1] : undefined,
    extractFirstJsonObject(text),
    text.trim(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        workflowBody?: unknown;
        confidence?: unknown;
        assumptions?: unknown;
        generatedActions?: unknown;
        recommendedSelectors?: unknown;
        notes?: unknown;
      };
      if (typeof parsed.workflowBody === "string") {
        return {
          workflowBody: parsed.workflowBody,
          confidence: typeof parsed.confidence === "string" ? parsed.confidence : undefined,
          assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.map(String) : undefined,
          generatedActions: Array.isArray(parsed.generatedActions)
            ? (parsed.generatedActions as Array<{ step?: unknown; action?: unknown }>)
            : undefined,
          recommendedSelectors: Array.isArray(parsed.recommendedSelectors)
            ? parsed.recommendedSelectors.map(String)
            : undefined,
          notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : undefined,
        };
      }
    }
    catch {
      continue;
    }
  }
  return undefined;
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const character = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      }
      else if (character === "\\") {
        escaped = true;
      }
      else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
    }
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

function normalizeConfidence(value: string | undefined): "draft" | "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "draft";
}
