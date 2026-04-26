import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createPlannedArtifactManifest } from "./artifacts.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

/**
 * Real GitHub Check Run poster.
 *
 * The github-summary module already produces github-check.json, which is
 * a Check Run payload we can use directly. This module posts that payload
 * to the GitHub Checks API so the proof shows up inline on the PR.
 *
 * Authentication:
 * - Reads GITHUB_TOKEN (provided by GitHub Actions automatically when
 *   the workflow has `permissions: checks: write`).
 * - Reads GITHUB_REPOSITORY (always set inside Actions: "owner/repo").
 * - Reads GITHUB_SHA (the commit being checked).
 *
 * No Octokit dependency. Plain `fetch` against the REST API.
 *
 * If any required env var is missing, this is a no-op that returns a
 * "skipped" result. The local CLI can still call this for testing.
 */

export type GithubCheckPostResult = {
  status: "posted" | "updated" | "skipped" | "error";
  reason?: string;
  caseId: string;
  conclusion: "success" | "failure" | "neutral";
  checkRunId?: number;
  htmlUrl?: string;
  commentId?: number;
  commentHtmlUrl?: string;
};

export type GithubCheckPostOptions = {
  /**
   * The personal access token or `GITHUB_TOKEN`. Defaults to env.
   */
  token?: string;
  /**
   * "owner/repo" string. Defaults to GITHUB_REPOSITORY env.
   */
  repository?: string;
  /**
   * Commit SHA. Defaults to GITHUB_SHA env.
   */
  headSha?: string;
  /**
   * Optional pull request number to also post a comment on.
   * Defaults to parsing GITHUB_REF / GITHUB_EVENT_PATH if available.
   */
  pullRequestNumber?: number;
  /**
   * If true, never post; just preview. Useful for local testing.
   */
  dryRun?: boolean;
};

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "forensic-repo-surgeon/1.0";

export async function postGithubCheckRun(
  caseFile: CaseFile,
  options: GithubCheckPostOptions = {},
): Promise<GithubCheckPostResult> {
  const manifest = createPlannedArtifactManifest(caseFile);
  const checkPath = resolve(manifest.files.githubCheckJson);
  const payload = await readJson<GithubCheckPayloadShape>(checkPath);

  if (!payload) {
    return {
      status: "skipped",
      reason: `github-check.json is missing at ${checkPath}. Run \`pnpm surgeon github-summary\` first.`,
      caseId: caseFile.id,
      conclusion: "neutral",
    };
  }

  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  const headSha = options.headSha ?? process.env.GITHUB_SHA;
  const conclusion = payload.conclusion ?? "neutral";

  if (options.dryRun) {
    return {
      status: "skipped",
      reason: "dryRun: would post a check run with the constructed payload",
      caseId: caseFile.id,
      conclusion,
    };
  }

  if (!token || !repository || !headSha) {
    return {
      status: "skipped",
      reason: [
        !token ? "GITHUB_TOKEN missing" : null,
        !repository ? "GITHUB_REPOSITORY missing" : null,
        !headSha ? "GITHUB_SHA missing" : null,
      ]
        .filter(Boolean)
        .join("; "),
      caseId: caseFile.id,
      conclusion,
    };
  }

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    return {
      status: "error",
      reason: `GITHUB_REPOSITORY must be 'owner/repo', got ${repository}`,
      caseId: caseFile.id,
      conclusion,
    };
  }

  const checkBody = {
    name: `Forensic Repo Surgeon: ${caseFile.id}`,
    head_sha: headSha,
    status: "completed" as const,
    conclusion,
    output: {
      title: payload.title ?? `Proof for ${caseFile.id}`,
      summary: buildCheckSummary(payload),
      text: buildCheckText(payload),
    },
  };

  let checkResponse: Response;
  try {
    checkResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/check-runs`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        authorization: `Bearer ${token}`,
        "user-agent": USER_AGENT,
        "content-type": "application/json",
      },
      body: JSON.stringify(checkBody),
    });
  }
  catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      caseId: caseFile.id,
      conclusion,
    };
  }

  if (!checkResponse.ok) {
    const errorText = await checkResponse.text().catch(() => "");
    return {
      status: "error",
      reason: `GitHub Checks API returned ${checkResponse.status}: ${truncate(errorText, 800)}`,
      caseId: caseFile.id,
      conclusion,
    };
  }

  const checkResult = (await checkResponse.json()) as { id?: number; html_url?: string };

  // Best-effort PR comment.
  const pullRequestNumber = options.pullRequestNumber ?? (await detectPullRequestNumber());
  let commentId: number | undefined;
  let commentHtmlUrl: string | undefined;
  if (pullRequestNumber) {
    try {
      const commentResponse = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments`,
        {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            authorization: `Bearer ${token}`,
            "user-agent": USER_AGENT,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            body: buildPrCommentBody(payload, owner, repo, headSha),
          }),
        },
      );
      if (commentResponse.ok) {
        const commentResult = (await commentResponse.json()) as { id?: number; html_url?: string };
        commentId = commentResult.id;
        commentHtmlUrl = commentResult.html_url;
      }
    }
    catch {
      // Non-fatal.
    }
  }

  return {
    status: "posted",
    caseId: caseFile.id,
    conclusion,
    checkRunId: checkResult.id,
    htmlUrl: checkResult.html_url,
    commentId,
    commentHtmlUrl,
  };
}

type GithubCheckPayloadShape = {
  caseId?: string;
  title?: string;
  conclusion?: "success" | "failure" | "neutral";
  summary?: {
    status?: string;
    score?: number;
    verificationStatus?: string;
    beforeNegativeControlStatus?: string;
    redactionReport?: string;
  };
  failedGates?: string[];
  artifacts?: Record<string, string>;
  residualRisks?: string[];
};

function buildCheckSummary(payload: GithubCheckPayloadShape): string {
  const score = payload.summary?.score ?? "n/a";
  const status = payload.summary?.status ?? "missing";
  const verification = payload.summary?.verificationStatus ?? "missing";
  const negativeControl = payload.summary?.beforeNegativeControlStatus ?? "missing";
  return [
    `**Scorecard:** ${status} (score ${score})`,
    `**Verification:** ${verification}`,
    `**Before-state negative control:** ${negativeControl}`,
    payload.failedGates && payload.failedGates.length > 0
      ? `**Failed gates:** ${payload.failedGates.map((gate) => `\`${gate}\``).join(", ")}`
      : "**Failed gates:** none",
  ].join("\n\n");
}

function buildCheckText(payload: GithubCheckPayloadShape): string {
  const lines: string[] = [];
  lines.push("## Proof Artifacts", "");
  for (const [label, path] of Object.entries(payload.artifacts ?? {})) {
    lines.push(`- ${label}: \`${path}\``);
  }
  if (payload.residualRisks && payload.residualRisks.length > 0) {
    lines.push("", "## Residual Risks", "");
    for (const risk of payload.residualRisks) {
      lines.push(`- ${risk}`);
    }
  }
  lines.push(
    "",
    "## Truth Boundary",
    "",
    "Models propose. Verifiers decide. The deterministic verifier outside the model loop produced this scorecard from before/after browser evidence and JSON-configured assertions.",
  );
  return lines.join("\n");
}

function buildPrCommentBody(
  payload: GithubCheckPayloadShape,
  owner: string,
  repo: string,
  sha: string,
): string {
  const score = payload.summary?.score ?? "n/a";
  const status = payload.summary?.status ?? "missing";
  const conclusionEmoji = payload.conclusion === "success" ? "✅" : payload.conclusion === "failure" ? "❌" : "⚪";
  const baseBlobUrl = `https://github.com/${owner}/${repo}/blob/${sha}`;
  const screenshotPath = payload.artifacts?.["screenshot"];
  const successPath = payload.artifacts?.["success"];

  const lines: string[] = [
    `### ${conclusionEmoji} Forensic Repo Surgeon — ${payload.caseId ?? "case"}`,
    "",
    `**${status}** (score ${score}). The deterministic verifier evaluated before/after browser evidence and the JSON-configured assertion registry.`,
    "",
  ];

  if (screenshotPath || successPath) {
    lines.push("| Before | After |", "| --- | --- |");
    lines.push(
      `| ${screenshotPath ? `![before](${baseBlobUrl}/${screenshotPath}?raw=true)` : "(missing)"} | ${successPath ? `![after](${baseBlobUrl}/${successPath}?raw=true)` : "(missing)"} |`,
      "",
    );
  }

  lines.push(buildCheckSummary(payload), "");

  if (payload.artifacts) {
    lines.push("<details><summary>Proof artifacts</summary>", "");
    for (const [label, path] of Object.entries(payload.artifacts)) {
      lines.push(`- [${label}](${baseBlobUrl}/${path})`);
    }
    lines.push("", "</details>");
  }

  return lines.join("\n");
}

async function detectPullRequestNumber(): Promise<number | undefined> {
  // GitHub Actions sets GITHUB_REF for pull_request events as
  //   refs/pull/<NUMBER>/merge
  const ref = process.env.GITHUB_REF;
  if (ref) {
    const match = ref.match(/refs\/pull\/(\d+)\//u);
    if (match?.[1]) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isFinite(n) && n > 0) {
        return n;
      }
    }
  }
  // Alternatively, the event payload at GITHUB_EVENT_PATH has it.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const text = await readFile(eventPath, "utf8");
      const event = JSON.parse(text) as { pull_request?: { number?: number }; number?: number };
      if (event.pull_request?.number && Number.isFinite(event.pull_request.number)) {
        return event.pull_request.number;
      }
      if (typeof event.number === "number" && event.number > 0) {
        return event.number;
      }
    }
    catch {
      // Ignore.
    }
  }
  return undefined;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  catch {
    return undefined;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
