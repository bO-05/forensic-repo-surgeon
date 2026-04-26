import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { getCrwaTargetRepoPath } from "./targets/crwa-lifecycle.ts";
import { type CaseFile } from "../../schemas/src/index.ts";

type AxTree = {
  nodes?: AxNode[];
};

type AxNode = {
  nodeId?: string;
  ignored?: boolean;
  role?: {
    value?: string;
  };
  name?: {
    value?: string;
  };
  backendDOMNodeId?: number;
};

type DomSnapshot = {
  strings?: string[];
  documents?: DomDocument[];
};

type DomDocument = {
  nodes?: {
    nodeName?: number[];
    attributes?: number[][];
  };
};

type EvidenceSignal = {
  kind: "case-text" | "dom-attribute" | "dom-class" | "ax-node" | "third-party-source";
  value: string;
  weight: number;
  source: string;
  attribute?: string;
  nodeName?: string;
  nodeIndex?: number;
  role?: string;
  backendDOMNodeId?: number;
};

type HighSignalDomAttribute = {
  nodeIndex: number;
  nodeName: string;
  attribute: string;
  value: string;
};

type HighSignalAxNode = {
  nodeId?: string;
  backendDOMNodeId?: number;
  role: string;
  name: string;
};

type MatchedSignal = EvidenceSignal & {
  line?: number;
};

type LocalizationCandidate = {
  rank: number;
  file: string;
  relativeFile: string;
  score: number;
  reasons: string[];
  matchedSignals: MatchedSignal[];
};

type LocalizationReport = {
  caseId: string;
  generatedAt: string;
  repoPath: string;
  artifactDirectory: string;
  method: string[];
  evidence: {
    keywords: string[];
    highSignalDomAttributes: HighSignalDomAttribute[];
    highSignalAxNodes: HighSignalAxNode[];
    thirdPartySources: string[];
  };
  candidates: LocalizationCandidate[];
};

type GenerateLocalizationOptions = {
  repoPath?: string;
  outPath?: string;
  limit?: number;
};

type KeywordProfile = {
  primaryKeywords: string[];
  caseKeywords: string[];
};

const SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);
const SIGNAL_ATTRIBUTES = new Set([
  "aria-label",
  "data-test",
  "data-testid",
  "data-vite-dev-id",
  "id",
]);
const STOP_WORDS = new Set([
  "about",
  "after",
  "all",
  "and",
  "authenticated",
  "app",
  "are",
  "before",
  "can",
  "capture",
  "captured",
  "current",
  "evidence",
  "for",
  "from",
  "into",
  "local",
  "mobile",
  "must",
  "passes",
  "perform",
  "proof",
  "open",
  "route",
  "screen",
  "screens",
  "steps",
  "target",
  "through",
  "trace",
  "user",
  "users",
  "verification",
  "visible",
  "when",
  "with",
  "without",
  "that",
  "the",
  "this",
]);

export async function generateLocalizationCandidates(
  caseFile: CaseFile,
  options: GenerateLocalizationOptions = {},
): Promise<string> {
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const repoPath = resolveRepoPath(caseFile, options.repoPath);
  const keywordProfile = buildKeywordProfile(caseFile);
  const evidence = await collectEvidenceSignals(caseFile, artifactDirectory, keywordProfile);
  const sourceRoot = existsSync(join(repoPath, "src")) ? join(repoPath, "src") : repoPath;
  const sourceFiles = await listSourceFiles(sourceRoot);
  const candidates = await scoreSourceFiles(sourceFiles, repoPath, evidence.signals, keywordProfile.caseKeywords);
  const outPath = resolve(options.outPath ?? join(artifactDirectory, "candidates.json"));

  const report: LocalizationReport = {
    caseId: caseFile.id,
    generatedAt: new Date().toISOString(),
    repoPath,
    artifactDirectory,
    method: [
      "Extract high-signal UI hooks from DOMSnapshot attributes.",
      "Extract visible roles and names from the accessibility tree.",
      "Scan first-party source files for exact hook, class, import, and case-keyword matches.",
      "Rank files by explainable signal weights; do not claim source-map certainty.",
    ],
    evidence: {
      keywords: evidence.keywords,
      highSignalDomAttributes: evidence.highSignalDomAttributes,
      highSignalAxNodes: evidence.highSignalAxNodes,
      thirdPartySources: evidence.thirdPartySources,
    },
    candidates: candidates.slice(0, options.limit ?? 10),
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return outPath;
}

function resolveRepoPath(caseFile: CaseFile, requestedRepoPath?: string): string {
  const candidates = [
    requestedRepoPath,
    caseFile.target.repo === "cypress-realworld-app" ? getCrwaTargetRepoPath() : undefined,
    caseFile.target.repo,
    isAbsolute(caseFile.target.repo) ? caseFile.target.repo : resolve(caseFile.target.repo),
    resolve("demo-targets", caseFile.target.repo),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of unique(candidates)) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    `Could not resolve target repo for ${caseFile.target.repo}. Pass --repo or run pnpm surgeon target setup.`,
  );
}

async function collectEvidenceSignals(
  caseFile: CaseFile,
  artifactDirectory: string,
  keywordProfile: KeywordProfile,
): Promise<{
  signals: EvidenceSignal[];
  keywords: string[];
  highSignalDomAttributes: HighSignalDomAttribute[];
  highSignalAxNodes: HighSignalAxNode[];
  thirdPartySources: string[];
}> {
  const signalMap = new Map<string, EvidenceSignal>();
  const highSignalDomAttributes: HighSignalDomAttribute[] = [];
  const highSignalAxNodes: HighSignalAxNode[] = [];
  const thirdPartySources = new Set<string>();

  const addSignal = (signal: EvidenceSignal) => {
    const value = signal.value.trim();
    if (value.length < 3) {
      return;
    }

    const key = `${signal.kind}:${value.toLowerCase()}`;
    const existing = signalMap.get(key);
    if (!existing || signal.weight > existing.weight) {
      signalMap.set(key, { ...signal, value });
    }
  };

  addKeywordSignals(
    [caseFile.title, caseFile.input.note, ...caseFile.repro.steps].join(" "),
    "case-text",
    4,
    "case file",
    addSignal,
  );

  for (const keyword of keywordProfile.caseKeywords) {
    addSignal({
      kind: "case-text",
      value: keyword,
      weight: 6,
      source: "case keyword",
    });
  }

  const domPath = join(artifactDirectory, "dom-snapshot.json");
  if (existsSync(domPath)) {
    const domSnapshot = JSON.parse(await readFile(domPath, "utf8")) as DomSnapshot;
    const strings = domSnapshot.strings ?? [];

    for (const document of domSnapshot.documents ?? []) {
      const nodes = document.nodes;
      const nodeNames = nodes?.nodeName ?? [];
      const attributes = nodes?.attributes ?? [];

      for (let nodeIndex = 0; nodeIndex < nodeNames.length; nodeIndex += 1) {
        const nodeName = stringAt(strings, nodeNames[nodeIndex]) ?? "unknown";
        const nodeAttributes = attributes[nodeIndex] ?? [];

        for (let index = 0; index < nodeAttributes.length; index += 2) {
          const attribute = stringAt(strings, nodeAttributes[index]);
          const value = stringAt(strings, nodeAttributes[index + 1]);

          if (!attribute || !value) {
            continue;
          }

          if (attribute === "data-vite-dev-id") {
            thirdPartySources.add(value);
            addSignal({
              kind: "third-party-source",
              value: basenameWithoutExtension(value),
              weight: 10,
              source: value,
              attribute,
              nodeName,
              nodeIndex,
            });
            continue;
          }

          if (SIGNAL_ATTRIBUTES.has(attribute) && isRelevantUiText(value, keywordProfile.primaryKeywords)) {
            highSignalDomAttributes.push({ nodeIndex, nodeName, attribute, value });
            addSignal({
              kind: "dom-attribute",
              value,
              weight: attribute.startsWith("data-") ? 45 : 30,
              source: `DOM ${attribute}`,
              attribute,
              nodeName,
              nodeIndex,
            });
            addKeywordSignals(value, "dom-attribute", 12, `DOM ${attribute}`, addSignal);
          }

          if (attribute === "class") {
            for (const className of extractUsefulClassNames(value, keywordProfile.primaryKeywords)) {
              addSignal({
                kind: "dom-class",
                value: className,
                weight: className.includes("react-calendar") ? 12 : 16,
                source: "DOM class",
                attribute,
                nodeName,
                nodeIndex,
              });
            }
          }
        }
      }
    }
  }

  const axPath = join(artifactDirectory, "ax-tree.json");
  if (existsSync(axPath)) {
    const axTree = JSON.parse(await readFile(axPath, "utf8")) as AxTree;

    for (const node of axTree.nodes ?? []) {
      const role = node.role?.value;
      const name = node.name?.value?.trim();

      if (node.ignored || !role || !name || name.length > 120) {
        continue;
      }

      if (!isRelevantUiText(name, keywordProfile.primaryKeywords)) {
        continue;
      }

      highSignalAxNodes.push({
        nodeId: node.nodeId,
        backendDOMNodeId: node.backendDOMNodeId,
        role,
        name,
      });
      addSignal({
        kind: "ax-node",
        value: name,
        weight: role === "button" ? 18 : 10,
        source: `AX ${role}`,
        role,
        backendDOMNodeId: node.backendDOMNodeId,
      });
      addKeywordSignals(name, "ax-node", 6, `AX ${role}`, addSignal);
    }
  }

  const signals = [...signalMap.values()];
  return {
    signals,
    keywords: unique(signals.map((signal) => signal.value)).slice(0, 80),
    highSignalDomAttributes: highSignalDomAttributes.slice(0, 80),
    highSignalAxNodes: highSignalAxNodes.slice(0, 40),
    thirdPartySources: [...thirdPartySources].slice(0, 20),
  };
}

function addKeywordSignals(
  text: string,
  kind: EvidenceSignal["kind"],
  weight: number,
  source: string,
  addSignal: (signal: EvidenceSignal) => void,
): void {
  for (const word of tokenize(text)) {
    addSignal({ kind, value: word, weight, source });
  }
}

async function scoreSourceFiles(
  sourceFiles: string[],
  repoPath: string,
  signals: EvidenceSignal[],
  caseKeywords: string[],
): Promise<LocalizationCandidate[]> {
  const candidates: Omit<LocalizationCandidate, "rank">[] = [];

  for (const file of sourceFiles) {
    const content = await readFile(file, "utf8");
    const lowerContent = content.toLowerCase();
    const relativeFile = normalizePath(relative(repoPath, file));
    const lowerRelativeFile = relativeFile.toLowerCase();
    const matchedSignals: MatchedSignal[] = [];
    let score = 0;

    for (const signal of signals) {
      const needle = signal.value.toLowerCase();
      const contentIndex = lowerContent.indexOf(needle);
      const pathMatch = lowerRelativeFile.includes(needle);

      if (contentIndex === -1 && !pathMatch) {
        continue;
      }

      const pathBoost = pathMatch ? 6 : 0;
      score += signal.weight + pathBoost;
      matchedSignals.push({
        ...signal,
        weight: signal.weight + pathBoost,
        line: contentIndex === -1 ? undefined : lineForIndex(content, contentIndex),
      });
    }

    for (const keyword of caseKeywords) {
      if (lowerRelativeFile.includes(keyword)) {
        score += 8;
      }
    }

    if (score > 0) {
      const sortedSignals = matchedSignals
        .sort((left, right) => right.weight - left.weight)
        .slice(0, 16);
      candidates.push({
        file,
        relativeFile,
        score,
        reasons: deriveReasons(relativeFile, sortedSignals, caseKeywords),
        matchedSignals: sortedSignals,
      });
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .map((candidate, index) => ({
      rank: index + 1,
      ...candidate,
    }));
}

async function listSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(root, entry.name);

    if (entry.isDirectory()) {
      if ([".git", "coverage", "dist", "node_modules"].includes(entry.name)) {
        continue;
      }
      files.push(...(await listSourceFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) && !isTestFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isTestFile(fileName: string): boolean {
  return /\.(cy|spec|test)\.[jt]sx?$/.test(fileName);
}

function deriveReasons(relativeFile: string, matchedSignals: MatchedSignal[], caseKeywords: string[]): string[] {
  const reasons: string[] = [];
  const hasDataHook = matchedSignals.some(
    (signal) => signal.kind === "dom-attribute" && signal.attribute?.startsWith("data-"),
  );
  const hasRelevantClass = matchedSignals.some((signal) => signal.kind === "dom-class");
  const hasAxText = matchedSignals.some((signal) => signal.kind === "ax-node");
  const lowerFile = relativeFile.toLowerCase();

  if (hasDataHook) {
    reasons.push("Matches data-test hooks found in the captured DOM.");
  }

  if (hasRelevantClass) {
    reasons.push("Matches UI classes found in the captured browser state.");
  }

  if (hasAxText) {
    reasons.push("Matches accessible UI labels visible in the captured browser state.");
  }

  if (caseKeywords.some((keyword) => lowerFile.includes(keyword))) {
    reasons.push("File path/name matches the case vocabulary.");
  }

  if (reasons.length === 0) {
    reasons.push("Matches lower-weight case or UI vocabulary from the evidence bundle.");
  }

  return reasons;
}

function tokenize(text: string): string[] {
  return unique(
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z0-9]+/)
      .map((word) => word.toLowerCase())
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );
}

function extractUsefulClassNames(value: string, primaryKeywords: string[]): string[] {
  return unique(
    value
      .split(/\s+/)
      .filter((className) =>
        className.toLowerCase().includes("react-calendar") ||
        primaryKeywords.some((keyword) => className.toLowerCase().includes(keyword)),
      ),
  );
}

function isRelevantUiText(value: string, primaryKeywords: string[]): boolean {
  const lowerValue = value.toLowerCase();
  return primaryKeywords.some((keyword) => lowerValue.includes(keyword));
}

function stringAt(strings: string[], index: number | undefined): string | undefined {
  if (typeof index !== "number" || index < 0) {
    return undefined;
  }

  return strings[index];
}

function lineForIndex(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function basenameWithoutExtension(value: string): string {
  const normalized = normalizePath(value);
  const segments = normalized.split("/");
  const basename = segments[segments.length - 1] ?? value;
  return basename.replace(/\.[^.]+$/, "");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildKeywordProfile(caseFile: CaseFile): KeywordProfile {
  const caseKeywords = unique([
    ...tokenize(caseFile.title),
    ...tokenize(caseFile.input.note),
    ...caseFile.repro.steps.flatMap((step) => tokenize(step)),
    ...tokenize(caseFile.route),
    ...(caseFile.viewport.isMobile ? ["mobile"] : []),
  ]);
  const primaryKeywords = caseKeywords.filter((keyword) => !STOP_WORDS.has(keyword));

  return {
    primaryKeywords: primaryKeywords.length > 0 ? primaryKeywords : ["dialog", "drawer", "modal"],
    caseKeywords,
  };
}
