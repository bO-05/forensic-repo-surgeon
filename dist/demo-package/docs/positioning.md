# Positioning

Forensic Repo Surgeon is not trying to replace Cursor, Devin, GitHub Copilot coding agent, or CodeRabbit.

It should sit beside them as a frontend repair proof layer.

## Competitive Map

| Tool | Center Of Gravity | What It Optimizes | What It Does Not Primarily Prove |
| --- | --- | --- | --- |
| Cursor | IDE-first coding with foreground and background agents | Fast developer-in-the-loop code editing | That a specific browser bug was reproduced, fixed, and packaged with proof |
| Devin | Cloud software engineer for delegated tasks, including advertised visual QA | Autonomous backlog execution across tools and repos | An open, portable proof contract that a repo can evaluate independently |
| GitHub Copilot coding agent | GitHub-native issue-to-PR work | Turning assigned tasks into PRs inside GitHub | Deep UI evidence custody before a reviewer sees the PR |
| CodeRabbit | PR review and planning | Finding issues in changed code and review workflows | Owning the full reproduce-localize-fix-verify loop before review |
| Forensic Repo Surgeon | Verified frontend repair package | Browser evidence, deterministic assertions, scorecard, static proof | Broad autonomous software engineering |

## Root Differentiation

Most AI coding products optimize for producing or reviewing a diff. The short pitch is:

> Agents create diffs. Forensic Repo Surgeon creates proof.

Forensic Repo Surgeon optimizes for answering:

> What exactly failed, what changed, what evidence proves it changed, and what machine-readable gate decided success?

That is a smaller product, but a clearer one.

The claim is not that other agents cannot run browsers. Devin explicitly advertises visual QA. The sharper claim is that this project makes the proof contract first-class, local, inspectable, exportable, and benchmarked.

The honest current weakness is reproduction authoring. Broad agents may be better at taking an issue and navigating an unfamiliar app. Forensic Repo Surgeon should integrate that capability as an agentic scaffolder, then remain strict about proof gates once the repro exists.

## Why This Can Matter

Frontend bugs are often hard to trust from a patch alone. A reviewer wants:

- before screenshot, trace, and negative-control failure
- after screenshot and trace
- DOM and accessibility evidence
- source localization rationale
- clear patch scope
- deterministic assertions
- `scorecard.json` as the machine-readable acceptance artifact
- residual risk
- a PR-style summary

The product should make this package automatic.

## Integration Strategy

Forensic Repo Surgeon can become the verification layer for broader agents:

- Cursor or Claude Code can implement a candidate patch locally.
- Devin or Copilot can open a branch or PR.
- Forensic Repo Surgeon can rerun the browser case and attach proof.
- CodeRabbit or a human reviewer can review the resulting PR with evidence instead of claims.

This makes the project complementary, not redundant.

## Sources Checked

Official docs and product pages checked on 2026-04-24:

- Cursor Agent modes: https://docs.cursor.com/en/chat/agent
- Cursor Background Agents: https://docs.cursor.com/en/background-agents
- Devin docs: https://docs.devin.ai/
- Devin SDLC integration: https://docs.devin.ai/essential-guidelines/sdlc-integration
- Devin Review: https://docs.devin.ai/work-with-devin/devin-review
- GitHub Copilot coding agent: https://docs.github.com/en/copilot/concepts/about-assigning-tasks-to-copilot
- GitHub Copilot PR creation: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/assign-copilot-to-an-issue
- CodeRabbit docs: https://docs.coderabbit.ai/
- CodeRabbit PR reviews: https://docs.coderabbit.ai/overview/pull-request-review
