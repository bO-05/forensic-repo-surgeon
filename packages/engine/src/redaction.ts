import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type NdjsonRecord = Record<string, unknown>;
type RedactionRule = "email" | "token" | "query-token" | "cookie";

type FileRedaction = {
  path: string;
  redactionCount: number;
  rules: Record<string, number>;
};

export type RedactionReport = {
  schemaVersion: 1;
  caseId: string;
  generatedAt: string;
  status: "passing" | "warning" | "failing";
  policyVersion: string;
  totalRedactions: number;
  files: FileRedaction[];
};

export type RedactionContext = {
  caseId: string;
  record(filePath: string, rule: RedactionRule, count: number): void;
  toReport(): RedactionReport;
};

const POLICY_VERSION = "2026-04-26.standard";
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const BEARER_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/=-]+)/gu;
const QUERY_SECRET_PATTERN = /([?&](?:access_token|api_key|apikey|auth|code|key|password|refresh_token|secret|session|token)=)([^&#\s]+)/giu;
const COOKIE_SECRET_PATTERN = /(^|[;\s])((?:access_token|auth|jwt|refresh_token|session|sessionid|sid|token)=)([^;\s]+)/giu;

export function createRedactionContext(caseId: string): RedactionContext {
  const files = new Map<string, FileRedaction>();

  return {
    caseId,
    record(filePath, rule, count) {
      if (count <= 0) {
        return;
      }

      const file = files.get(filePath) ?? {
        path: filePath,
        redactionCount: 0,
        rules: {},
      };

      file.redactionCount += count;
      file.rules[rule] = (file.rules[rule] ?? 0) + count;
      files.set(filePath, file);
    },
    toReport() {
      const fileReports = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
      const totalRedactions = fileReports.reduce((sum, file) => sum + file.redactionCount, 0);

      return {
        schemaVersion: 1,
        caseId,
        generatedAt: new Date().toISOString(),
        status: "passing",
        policyVersion: POLICY_VERSION,
        totalRedactions,
        files: fileReports,
      };
    },
  };
}

export function redactJsonValue(value: unknown, context: RedactionContext, filePath: string): unknown {
  if (typeof value === "string") {
    return redactString(value, context, filePath);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item, context, filePath));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJsonValue(item, context, filePath)]),
    );
  }

  return value;
}

export function redactNdjsonRecords<T extends NdjsonRecord>(
  records: T[],
  context: RedactionContext,
  filePath: string,
): T[] {
  return records.map((record) => redactJsonValue(record, context, filePath) as T);
}

export async function writeRedactedJsonFile(path: string, value: unknown, context: RedactionContext): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(redactJsonValue(value, context, path), null, 2)}\n`, "utf8");
}

export async function writeRedactedNdjsonFile(
  path: string,
  records: NdjsonRecord[],
  context: RedactionContext,
): Promise<void> {
  const redacted = redactNdjsonRecords(records, context, path);
  const contents = redacted.map((record) => JSON.stringify(record)).join("\n") + (redacted.length ? "\n" : "");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

export async function writeRedactionReport(context: RedactionContext, reportPath: string): Promise<void> {
  const merged = mergeReports(await readExistingReport(reportPath), context.toReport());

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

function redactString(value: string, context: RedactionContext, filePath: string): string {
  let result = replaceAndCount(value, EMAIL_PATTERN, "[REDACTED:email]", context, filePath, "email");
  result = replaceAndCount(result, BEARER_PATTERN, "Bearer [REDACTED:token]", context, filePath, "token");
  result = replaceAndCount(result, QUERY_SECRET_PATTERN, "$1[REDACTED:query-token]", context, filePath, "query-token");
  result = replaceAndCount(result, COOKIE_SECRET_PATTERN, "$1$2[REDACTED:cookie]", context, filePath, "cookie");

  return result;
}

function replaceAndCount(
  value: string,
  pattern: RegExp,
  replacement: string,
  context: RedactionContext,
  filePath: string,
  rule: RedactionRule,
): string {
  let count = 0;
  const result = value.replace(pattern, (...args: string[]) => {
    count += 1;
    return replacement.replace(/\$(\d+)/gu, (_, index: string) => args[Number(index)] ?? "");
  });

  context.record(filePath, rule, count);
  return result;
}

async function readExistingReport(reportPath: string): Promise<RedactionReport | undefined> {
  if (!existsSync(reportPath)) {
    return undefined;
  }

  try {
    return JSON.parse(await readFile(reportPath, "utf8")) as RedactionReport;
  }
  catch {
    return undefined;
  }
}

function mergeReports(existing: RedactionReport | undefined, next: RedactionReport): RedactionReport {
  if (!existing) {
    return next;
  }

  const files = new Map<string, FileRedaction>();

  for (const report of [existing, next]) {
    for (const file of report.files) {
      const current = files.get(file.path) ?? {
        path: file.path,
        redactionCount: 0,
        rules: {},
      };

      files.set(file.path, {
        path: file.path,
        redactionCount: file.redactionCount,
        rules: { ...file.rules },
      });
    }
  }

  const fileReports = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    caseId: next.caseId,
    generatedAt: next.generatedAt,
    status: "passing",
    policyVersion: POLICY_VERSION,
    totalRedactions: fileReports.reduce((sum, file) => sum + file.redactionCount, 0),
    files: fileReports,
  };
}
