import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, win32, posix } from "node:path";
import { unzipSync, zipSync } from "fflate";

import { createRedactionContext, redactJsonValue } from "./redaction.ts";

type PathRoot = { path: string; label: string };
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 4096;
const PRIVATE_PATH = /(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]+|\/(?:home|Users|workspaces)\/)/u;

function variants(path: string): string[] {
  const forward = path.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const slashForms = [forward, forward.replace(/\//gu, "\\")];
  const forms = slashForms.flatMap(value => [value, JSON.stringify(value).slice(1, -1)]);
  return [...new Set(forms.flatMap(value => [value, value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;")]))];
}

function discoverRoots(text: string): PathRoot[] {
  const roots: PathRoot[] = [];
  const visit = (value: unknown, key = "") => {
    if (typeof value === "string") {
      const absolute = /^(?:[A-Za-z]:[\\/]|\/(?:home|Users|workspaces)\/)/u.test(value);
      const file = /[\\/][^\\/\r\n]+\.[A-Za-z0-9_-]{1,10}$/u.test(value);
      if (absolute && !value.includes("\n") && (file || /path|directory|repoRoot|workspace|cwd|executable/iu.test(key))) {
        roots.push({ path: file ? (/^[A-Za-z]:/u.test(value) ? win32.dirname(value) : posix.dirname(value)) : value, label: "[local]" });
      }
    } else if (Array.isArray(value)) {
      value.forEach(item => visit(item, key));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([name, item]) => visit(item, name));
    }
  };
  try {
    visit(JSON.parse(text));
  } catch {
    // NDJSON traces are independent JSON records, not one document.
    for (const line of text.split(/\r?\n/u)) {
      try { visit(JSON.parse(line)); } catch { /* Prose is handled by the fail-closed path replacements. */ }
    }
  }
  return roots.filter(root => root.path.length > 3);
}

function stringSanitizer(roots: readonly PathRoot[]): (text: string) => string {
  const known = new Map<string, PathRoot>();
  for (const root of roots) {
    if (!known.has(root.path.toLowerCase())) known.set(root.path.toLowerCase(), root);
  }
  const normalized = (path: string) => path.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
  const distinct = [...known.values()].filter(root => root.label !== "[local]" || ![...known.values()].some(parent => parent !== root && normalized(root.path).startsWith(`${normalized(parent.path)}/`)));
  const replacements = distinct.flatMap(root => variants(root.path).map(path => ({
    expression: new RegExp(path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu"),
    label: root.label,
    length: path.length,
  }))).sort((a, b) => b.length - a.length);
  const nonPrivatePrefix = roots.some(root => !PRIVATE_PATH.test(root.path));
  const context = createRedactionContext("public-export");
  return (text: string) => {
    let result = text;
    if (nonPrivatePrefix || PRIVATE_PATH.test(result)) {
      for (const replacement of replacements) result = result.replace(replacement.expression, replacement.label);
      // Unknown path tails may include spaces and are withheld rather than guessed.
      result = result.replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]+[^"<>\r\n`]*/gu, "[local-path]");
      result = result.replace(/(?<![A-Za-z0-9:/])\/(?:home|Users|workspaces)\/[^"<>\r\n`]*/gu, "[local-path]");
    }
    result = redactJsonValue(result, context, "public-copy") as string;
    if (PRIVATE_PATH.test(result)) throw new Error("Public export still contains a producer-machine path.");
    return result;
  };
}

export function sanitizePublicText(text: string, roots: readonly PathRoot[] = []): string {
  const allRoots = [...roots, ...discoverRoots(text)];
  const sanitizeString = stringSanitizer(allRoots);
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return sanitizeString(value);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      const output: Record<string, unknown> = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        const safeKey = sanitizeString(key);
        if (Object.hasOwn(output, safeKey)) throw new Error("Public sanitization would merge distinct object keys.");
        output[safeKey] = visit(item);
      }
      return output;
    }
    return value;
  };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* May be NDJSON or prose. */ }
  if (parsed !== undefined) return JSON.stringify(visit(parsed), null, 2) + (text.endsWith("\n") ? "\n" : "");
  const lines = text.trim().split(/\r?\n/u);
  if (lines.length > 1) {
    let records: unknown[] | undefined;
    try { records = lines.map(line => JSON.parse(line)); } catch { /* Not NDJSON. */ }
    if (records) return records.map(record => JSON.stringify(visit(record))).join("\n") + "\n";
  }
  return sanitizeString(text);
}

function decodeText(bytes: Uint8Array): string | undefined {
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

function archive(bytes: Uint8Array, roots: readonly PathRoot[], depth: number): Uint8Array {
  if (depth > 2 || bytes.length > MAX_ARCHIVE_BYTES) throw new Error("Public archive exceeds the sanitization limit.");
  let total = 0;
  let count = 0;
  const entries = unzipSync(bytes, { filter: entry => {
    total += entry.originalSize;
    count += 1;
    if (entry.originalSize > MAX_ARCHIVE_BYTES || total > MAX_ARCHIVE_BYTES || count > MAX_ARCHIVE_ENTRIES) throw new Error("Public archive exceeds the sanitization limit.");
    return true;
  } });
  const inferred = Object.values(entries).flatMap(value => {
    const text = decodeText(value);
    return text === undefined ? [] : discoverRoots(text);
  });
  const output: Record<string, Uint8Array> = Object.create(null);
  for (const [name, value] of Object.entries(entries)) {
    const normalized = name.replace(/\\/gu, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..") || PRIVATE_PATH.test(name)) throw new Error("Public archive contains an unsafe entry name.");
    output[name] = /\.zip$/iu.test(name) ? archive(value, [...roots, ...inferred], depth + 1) : sanitizeBytes(value, [...roots, ...inferred]);
  }
  return zipSync(output, { level: 6, mtime: new Date("1980-01-02T00:00:00Z") });
}

function sanitizeBytes(bytes: Uint8Array, roots: readonly PathRoot[]): Uint8Array {
  const text = decodeText(bytes);
  return text === undefined ? bytes : new TextEncoder().encode(sanitizePublicText(text, roots));
}

export async function sanitizePublicDirectory(root: string, sourceRoots: readonly PathRoot[] = []): Promise<{ files: number; changedFiles: number }> {
  const paths: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Public export must not contain symlinks.");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) paths.push(path);
    }
  };
  await walk(root);
  const roots = [...sourceRoots, { path: homedir(), label: "[home]" }];
  // Discover recorded producer roots, which may differ from the export machine.
  for (const path of paths) {
    if (!/\.(?:json|ndjson|trace|network|stacks)$/iu.test(path)) continue;
    const text = decodeText(await readFile(path));
    if (text !== undefined) roots.push(...discoverRoots(text));
  }
  let changedFiles = 0;
  for (const path of paths) {
    const before = await readFile(path);
    let after = /\.zip$/iu.test(path) ? archive(before, roots, 0) : sanitizeBytes(before, roots);
    if (/\.html$/iu.test(path)) {
      const html = decodeText(after);
      if (html !== undefined && /<body\b/iu.test(html) && !html.includes('data-public-export-notice="true"')) {
        after = new TextEncoder().encode(html.replace(/<body\b[^>]*>/iu, '$&\n<aside data-public-export-notice="true" role="note" style="padding:16px;background:#f5ead1;color:#172024;font:14px/1.6 sans-serif">Privacy-sanitized recorded evidence. Local paths and text secrets were removed from this public copy, including browser trace text. Verification outcomes are recorded results, not a new model or verifier run.</aside>'));
      }
    }
    if (!before.equals(Buffer.from(after))) {
      await writeFile(path, after);
      changedFiles += 1;
    }
    // Validate archives by decoding them again, not by scanning compressed bytes.
    if (/\.zip$/iu.test(path)) {
      for (const value of Object.values(unzipSync(after))) {
        const text = decodeText(value);
        if (text !== undefined && PRIVATE_PATH.test(text)) throw new Error(`Public archive path check failed: ${relative(root, path)}`);
      }
    }
  }
  return { files: paths.length, changedFiles };
}
