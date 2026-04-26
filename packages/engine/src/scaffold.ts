import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import {
  persistAgenticScaffoldTranscript,
  runLiveAgenticScaffold,
  type LiveScaffoldResult,
} from "./agentic-scaffold.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

export type ScaffoldOptions = {
  id: string;
  title?: string;
  targetRepo?: string;
  stack?: string;
  bugText?: string;
  screenshotPath?: string;
  baseUrl?: string;
  route?: string;
  viewport?: "mobile" | "desktop";
  authMode?: "none" | "ui" | "storageState";
  username?: string;
  password?: string;
  steps?: string[];
  visibleSelector?: string;
  expectedFailures?: string[];
  outDir?: string;
  agentic?: boolean;
  /**
   * Disable the live Claude Code agent path even if ANTHROPIC_API_KEY is set.
   * Useful for offline/test runs that want a deterministic regex output.
   */
  offlineOnly?: boolean;
};

export type ScaffoldResult = {
  casePath: string;
  workflowPath: string;
  guidePath: string;
  analysisPath?: string;
  scaffoldTracePath?: string;
  modelAuthored: boolean;
  modelProvider?: "claude-agent-sdk";
  confidence?: LiveScaffoldResult["confidence"] | "draft";
};

export async function scaffoldCase(options: ScaffoldOptions): Promise<ScaffoldResult> {
  if (!options.id || !/^[a-z0-9][a-z0-9-]*$/u.test(options.id)) {
    throw new Error("Scaffold requires --id using lowercase letters, numbers, and dashes.");
  }

  const outDir = options.outDir ?? "cases";
  const casePath = resolve(outDir, `${options.id}.case.json`);
  const workflowPath = resolve(outDir, `${options.id}.workflow.ts`);
  const guidePath = resolve(outDir, `${options.id}.scaffold.md`);
  const analysisPath = resolve(outDir, `${options.id}.scaffold-analysis.json`);
  const caseFile = buildCaseFile(options, workflowPath);

  // When --agentic is set AND we have an API key AND the live path isn't
  // explicitly disabled, ask Claude Code to draft the workflow. The regex
  // fallback below is what runs offline.
  let liveResult: LiveScaffoldResult | undefined;
  if (options.agentic && !options.offlineOnly) {
    liveResult = await runLiveAgenticScaffold({
      id: options.id,
      bugText: options.bugText,
      screenshotPath: options.screenshotPath,
      baseUrl: options.baseUrl,
      route: options.route,
      viewport: options.viewport ?? "mobile",
      steps: options.steps,
      visibleSelector: options.visibleSelector,
      expectedFailures: options.expectedFailures,
    });
  }

  await mkdir(dirname(casePath), { recursive: true });
  await writeFile(casePath, `${JSON.stringify(caseFile, null, 2)}\n`, "utf8");
  await writeFile(workflowPath, renderWorkflowTemplate(options, workflowPath, liveResult), "utf8");
  await writeFile(guidePath, renderGuide(options, casePath, workflowPath, liveResult), "utf8");
  let scaffoldTracePath: string | undefined;
  if (options.agentic) {
    await writeFile(
      analysisPath,
      `${JSON.stringify(buildScaffoldAnalysis(options, liveResult), null, 2)}\n`,
      "utf8",
    );
    if (liveResult) {
      scaffoldTracePath = await persistAgenticScaffoldTranscript(outDir, options.id, liveResult);
    }
  }

  return {
    casePath,
    workflowPath,
    guidePath,
    analysisPath: options.agentic ? analysisPath : undefined,
    scaffoldTracePath,
    modelAuthored: Boolean(liveResult),
    modelProvider: liveResult ? "claude-agent-sdk" : undefined,
    confidence: liveResult?.confidence ?? (options.agentic ? "draft" : undefined),
  };
}

function buildCaseFile(options: ScaffoldOptions, workflowPath: string): CaseFile {
  const viewport = options.viewport ?? "mobile";
  const visibleSelector = options.visibleSelector ?? "[data-test=\"replace-me\"]";

  return {
    id: options.id,
    title: options.title ?? titleFromId(options.id),
    target: {
      repo: options.targetRepo ?? "replace-with-target-repo",
      stack: options.stack ?? "React",
      baseUrl: options.baseUrl ?? "http://localhost:3000",
    },
    workflow: "custom-script",
    workflowScript: toPosixRelative(workflowPath),
    route: options.route ?? "/",
    viewport: viewport === "mobile"
      ? {
          name: "iPhone 13",
          width: 390,
          height: 844,
          isMobile: true,
        }
      : {
          name: "Desktop 1280",
          width: 1280,
          height: 800,
          isMobile: false,
        },
    auth: {
      mode: options.authMode ?? "none",
      username: options.username,
      password: options.password,
      notes: "Edit auth fields or use storageState if the repro requires login.",
    },
    input: {
      screenshotPath: options.screenshotPath ?? `./inputs/${options.id}.png`,
      note: options.bugText
        ? `Draft scaffold from bug report: ${options.bugText}`
        : "Draft scaffold. Replace this note with the bug report or screenshot source before marking verified.",
    },
    repro: {
      steps: options.steps?.length
        ? options.steps
        : [
            "Open the route",
            "Use the custom workflow script to reach the failing UI state",
            "Capture before evidence and after verification",
          ],
    },
    artifacts: {
      directory: `./artifacts/${options.id}`,
    },
    verification: {
      mustPass: [
        "The workflow reaches the reproduced UI state",
        "Required visual assertions pass after the patch",
        "No unexpected console errors are introduced",
      ],
      assertions: [
        {
          type: "visible",
          name: "primary bug element is visible",
          selector: visibleSelector,
        },
        {
          type: "insideViewport",
          name: "primary bug element stays inside viewport",
          selector: visibleSelector,
        },
        {
          type: "noHorizontalOverflow",
          name: "page has no horizontal overflow",
        },
        {
          type: "noConsoleRegression",
          name: "no unexpected console errors appear during verification",
        },
      ],
      negativeControl: {
        artifact: "before-verify.json",
        expectedFailures: options.expectedFailures?.length
          ? options.expectedFailures
          : ["primary bug element stays inside viewport"],
      },
    },
  };
}

function renderWorkflowTemplate(
  options: ScaffoldOptions,
  workflowPath: string,
  liveResult?: LiveScaffoldResult,
): string {
  const schemaImportPath = toModuleSpecifier(relative(dirname(workflowPath), resolve("packages/schemas/src/index.ts")));

  let workflowLines: string[];
  if (liveResult?.workflowBody) {
    workflowLines = renderLiveWorkflowLines(liveResult);
  }
  else if (options.agentic) {
    workflowLines = renderAssistedWorkflowLines(options);
  }
  else {
    workflowLines = [
      "  // Example:",
      "  // await page.getByRole(\"button\", { name: /menu/i }).click();",
      "  // await page.locator('[data-test=\"mobile-nav-drawer\"]').waitFor({ state: \"visible\" });",
      "",
      ...(options.steps?.length
        ? [
            "  // Repro steps supplied at scaffold time:",
            ...options.steps.map((step, index) => `  // ${index + 1}. ${step}`),
            "",
          ]
        : []),
      "  throw new Error(`Edit ${caseFile.workflowScript} to reproduce the bug before running this case.`);",
    ];
  }

  return [
    "import { type Page } from \"@playwright/test\";",
    `import { type CaseFile } from "${schemaImportPath}";`,
    "",
    "export async function runWorkflow(page: Page, caseFile: CaseFile): Promise<void> {",
    "  // This file is intentionally small: encode only the user journey needed to reach the bug.",
    "  // The engine handles screenshots, traces, DOM snapshots, AX trees, assertions, and reports.",
    "  await page.waitForSelector(\"body\", { state: \"visible\", timeout: 15_000 });",
    "",
    ...workflowLines,
    "}",
    "",
  ].join("\n");
}

function renderLiveWorkflowLines(result: LiveScaffoldResult): string[] {
  const indented = ensureLeadingIndent(result.workflowBody.trim().split(/\r?\n/)).map((line) => line.trimEnd());
  return [
    `  // Drafted by Claude Code agent loop (provider: ${result.transcript.provider}, confidence: ${result.confidence}).`,
    `  // turns=${result.transcript.totalTurns}, toolCalls=${result.transcript.totalToolCalls}, model=${result.transcript.model ?? "unknown"}`,
    "  // Review selectors and assertions before marking this case verified.",
    "",
    ...indented,
    "",
  ];
}

function ensureLeadingIndent(lines: string[]): string[] {
  return lines.map((line) => {
    if (line.length === 0) return line;
    return line.startsWith("  ") ? line : `  ${line.replace(/^\t+/, "")}`;
  });
}

function renderAssistedWorkflowLines(options: ScaffoldOptions): string[] {
  const lines = [
    "  // Assisted draft generated from the supplied bug text and repro steps.",
    "  // Review selectors and role/text matches before marking this case verified.",
  ];

  for (const step of options.steps ?? []) {
    const normalized = normalizeActionText(step);

    if (/^(tap|click|press)\b/iu.test(step)) {
      lines.push(
        `  await page.getByRole("button", { name: /${escapeRegex(normalized)}/i }).click().catch(async () => {`,
        `    await page.getByText(/${escapeRegex(normalized)}/i).click();`,
        "  });",
      );
      continue;
    }

    if (/^(wait for|see|verify)\b/iu.test(step)) {
      lines.push(`  await page.getByText(/${escapeRegex(normalized)}/i).first().waitFor({ state: "visible", timeout: 15_000 });`);
      continue;
    }

    lines.push(`  // ${step}`);
  }

  if (options.visibleSelector) {
    lines.push(`  await page.locator(${quoteTsString(options.visibleSelector)}).first().waitFor({ state: "visible", timeout: 15_000 });`);
  }

  return [...lines, ""];
}

function buildScaffoldAnalysis(
  options: ScaffoldOptions,
  liveResult: LiveScaffoldResult | undefined,
): {
  confidence: "draft" | "low" | "medium" | "high";
  requiresHumanReview: boolean;
  modelAuthored: boolean;
  modelProvider?: "claude-agent-sdk";
  assumptions: string[];
  recommendedSelectors: string[];
  notes: string[];
  generatedActions: Array<{
    step: string;
    action: string;
  }>;
} {
  if (liveResult) {
    return {
      confidence: liveResult.confidence,
      requiresHumanReview: true,
      modelAuthored: true,
      modelProvider: "claude-agent-sdk",
      assumptions: liveResult.assumptions.length > 0
        ? liveResult.assumptions
        : [
            "Route navigation is handled by the engine before this workflow runs.",
            "The generated workflow is not proof until before and after verification artifacts pass.",
          ],
      recommendedSelectors: liveResult.recommendedSelectors,
      notes: liveResult.notes,
      generatedActions: liveResult.generatedActions.length > 0
        ? liveResult.generatedActions
        : (options.steps ?? []).map((step) => ({ step, action: "captured-from-step-list" })),
    };
  }

  return {
    confidence: "draft",
    requiresHumanReview: true,
    modelAuthored: false,
    assumptions: [
      "Route navigation is handled by the engine before this workflow runs.",
      "Button/text heuristics may need selector replacement in real apps.",
      "The generated workflow is not proof until before and after verification artifacts pass.",
    ],
    recommendedSelectors: [],
    notes: [
      "Heuristic regex draft used (offline). Set ANTHROPIC_API_KEY and rerun for a Claude-authored draft.",
    ],
    generatedActions: (options.steps ?? []).map((step) => ({
      step,
      action: /^(tap|click|press)\b/iu.test(step)
        ? "click role/text fallback"
        : /^(wait for|see|verify)\b/iu.test(step)
          ? "wait for visible text"
          : "comment only",
    })),
  };
}

function renderGuide(
  options: ScaffoldOptions,
  casePath: string,
  workflowPath: string,
  liveResult?: LiveScaffoldResult,
): string {
  const lines = [
    `# ${options.id} Scaffold`,
    "",
    "This is a draft scaffold, not proof. It lowers the new-bug setup burden, but the case is unverified until the workflow runs and the scorecard passes.",
    "",
    "## Files",
    "",
    `- Case contract: \`${toPosixRelative(casePath)}\``,
    `- Workflow script: \`${toPosixRelative(workflowPath)}\``,
    "",
  ];

  if (liveResult) {
    lines.push(
      "## Model Authorship",
      "",
      `- Provider: \`${liveResult.transcript.provider}\``,
      `- Model: \`${liveResult.transcript.model ?? "unknown"}\``,
      `- Turns: \`${liveResult.transcript.totalTurns}\``,
      `- Tool calls: \`${liveResult.transcript.totalToolCalls}\``,
      `- Confidence: \`${liveResult.confidence}\``,
      "",
    );
    if (liveResult.recommendedSelectors.length > 0) {
      lines.push("Recommended selectors to verify:", "", ...liveResult.recommendedSelectors.map((selector) => `- \`${selector}\``), "");
    }
    if (liveResult.notes.length > 0) {
      lines.push("Notes from the agent:", "", ...liveResult.notes.map((note) => `- ${note}`), "");
    }
  }

  lines.push(
    "## Finish The Case",
    "",
    "1. Edit the workflow script until it reaches the failing UI state.",
    "2. Replace placeholder selectors in the case file verification assertions.",
    "3. Confirm `verification.negativeControl.expectedFailures` names the assertion that should fail before the patch.",
    "4. Add or generate a patch fixture under `patches/` before expecting the full repair runner to pass.",
    "5. Run evidence capture against the target app.",
    "",
    "```bash",
    `pnpm surgeon evidence --case ${toPosixRelative(casePath)}`,
    `pnpm surgeon verify --case ${toPosixRelative(casePath)}`,
    "```",
    "",
    "## Truth Boundary",
    "",
    liveResult
      ? "The Claude Code agent drafted this workflow. The deterministic verifier still decides whether the case passes. Review selectors, then run the full pipeline."
      : options.agentic
        ? "This scaffold uses an offline regex draft because no live model session was available. It is honest as a starting point, but the deterministic verifier still decides acceptance."
        : "The intended next milestone is an agentic scaffolder that reads a bug ticket or screenshot and drafts this workflow script automatically. This scaffold is the contract that agent should generate.",
    "",
  );

  return lines.join("\n");
}

function normalizeActionText(step: string): string {
  return step
    .replace(/^(tap|click|press|wait for|see|verify)\s+/iu, "")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

function quoteTsString(value: string): string {
  return `'${value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'")}'`;
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toPosixRelative(path: string): string {
  return path
    .replace(resolve(".") + "\\", "")
    .replace(/\\/g, "/");
}

function toModuleSpecifier(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}
