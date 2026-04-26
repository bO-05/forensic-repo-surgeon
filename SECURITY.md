# Security Policy

## Supported Scope

This project is a local developer tool. The supported security boundary is:

- local source code
- local generated artifacts
- local target application process
- optional Anthropic API key loaded from `.env.local`

The project is not a hosted service and does not currently process untrusted public traffic.

## Secrets

Never commit real secrets. Use `.env.local`, which is ignored by git.

Required secret for live Anthropic runs:

```env
ANTHROPIC_API_KEY=
```

If a key is pasted into chat, terminal history, or a committed file, rotate it in the Anthropic console.

## Proof Artifact Privacy

Generated proof bundles can contain screenshots, traces, DOM snapshots, accessibility trees, console logs, network URLs, and case auth metadata. The engine writes `redaction-report.json` for each case and redacts common emails, bearer tokens, cookie/session values, and sensitive URL query parameters from JSON and NDJSON artifacts before they are shared.

Treat screenshots and Playwright traces as high-sensitivity artifacts. Review `redaction-report.json` before attaching proof bundles to public issues or pull requests.

## Reporting Issues

For security issues in a public repository, open a private advisory when available. Otherwise, contact the maintainer directly and avoid posting live keys or exploit details in public issues.
