import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createRedactionContext,
  redactJsonValue,
  redactNdjsonRecords,
  writeRedactionReport,
} from "../packages/engine/src/redaction.ts";

test("redacts common secrets and identity values from JSON artifacts", () => {
  const context = createRedactionContext("redaction-test");
  const redacted = redactJsonValue(
    {
      email: "ada@example.com",
      authorization: "Bearer abc.def.secret",
      url: "https://app.example.test/callback?token=secret-token&api_key=secret-key&ok=1",
      nested: {
        cookie: "sessionid=super-secret; theme=light",
      },
    },
    context,
    "input.json",
  );

  assert.deepEqual(redacted, {
    email: "[REDACTED:email]",
    authorization: "Bearer [REDACTED:token]",
    url: "https://app.example.test/callback?token=[REDACTED:query-token]&api_key=[REDACTED:query-token]&ok=1",
    nested: {
      cookie: "sessionid=[REDACTED:cookie]; theme=light",
    },
  });

  const report = context.toReport();
  assert.equal(report.caseId, "redaction-test");
  assert.ok(report.totalRedactions >= 4);
  assert.ok(report.files.some((file) => file.path === "input.json" && file.redactionCount >= 4));
});

test("redacts ndjson records while preserving record shape", () => {
  const context = createRedactionContext("redaction-test");
  const records = redactNdjsonRecords(
    [
      {
        type: "request",
        url: "https://api.example.test/users?password=hunter2",
      },
      {
        type: "console",
        text: "User test@example.com logged in with Bearer shh",
      },
    ],
    context,
    "network.ndjson",
  );

  assert.equal(records[0].url, "https://api.example.test/users?password=[REDACTED:query-token]");
  assert.equal(records[1].text, "User [REDACTED:email] logged in with Bearer [REDACTED:token]");
  assert.equal(context.toReport().files.find((file) => file.path === "network.ndjson")?.redactionCount, 3);
});

test("redaction report updates file counts without double-counting stale reruns", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "surgeon-redaction-report-"));
  const reportPath = join(outDir, "redaction-report.json");
  const first = createRedactionContext("redaction-test");
  const second = createRedactionContext("redaction-test");

  redactJsonValue({ email: "one@example.com" }, first, "input.json");
  await writeRedactionReport(first, reportPath);

  redactJsonValue({ email: "two@example.com" }, second, "input.json");
  await writeRedactionReport(second, reportPath);

  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    totalRedactions: number;
    files: Array<{ path: string; redactionCount: number }>;
  };

  assert.equal(report.totalRedactions, 1);
  assert.deepEqual(report.files, [{ path: "input.json", redactionCount: 1, rules: { email: 1 } }]);
});
