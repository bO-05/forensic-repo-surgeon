import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  chromium,
  type BrowserContextOptions,
  type ConsoleMessage,
  type Page,
  type Request,
} from "@playwright/test";

import {
  assertInsideViewport,
  assertNoConsoleRegression,
  assertNoHorizontalOverflow,
  assertNoOverlap,
  assertTopWithin,
  assertVisible,
  assertWidthAtLeast,
  type VerificationAssertion,
} from "./assertions.ts";
import { createPlannedArtifactManifest } from "./artifacts.ts";
import {
  createRedactionContext,
  writeRedactedJsonFile,
  writeRedactedNdjsonFile,
  writeRedactionReport,
} from "./redaction.ts";
import { type CaseFile, type VerificationAssertionContract } from "../../schemas/src/index.ts";

type CdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

type NdjsonRecord = Record<string, unknown>;

type VerificationResult = {
  caseId: string;
  status: "passing" | "failing";
  checkedAt: string;
  screenshot: string;
  assertions: VerificationAssertion[];
  negativeControl?: NegativeControlResult;
  error?: string;
};

type NegativeControlResult = {
  status: "passing" | "failing";
  expectedFailures: string[];
  actualFailures: string[];
  matchedExpectedFailures: string[];
  missingExpectedFailures: string[];
  additionalFailures: string[];
};

type VerificationCaptureOptions = {
  expectFailure?: boolean;
  expectedFailures?: string[];
  outputPath?: string;
  screenshotPath?: string;
};

type GeneratedUser = {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
};

const KNOWN_CONSOLE_NOISE_PATTERNS = [
  /invalid dom property/i,
  /status of 410/i,
];

function serializeConsoleMessage(message: ConsoleMessage): NdjsonRecord {
  return {
    type: message.type(),
    text: message.text(),
    location: message.location(),
  };
}

function serializeRequest(request: Request): NdjsonRecord {
  return {
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
  };
}

function buildContextOptions(caseFile: CaseFile): BrowserContextOptions {
  const contextOptions: BrowserContextOptions = {
    viewport: {
      width: caseFile.viewport.width,
      height: caseFile.viewport.height,
    },
    isMobile: caseFile.viewport.isMobile,
    userAgent: caseFile.viewport.isMobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  };

  if (caseFile.auth.mode === "storageState" && caseFile.auth.storageStatePath) {
    contextOptions.storageState = resolve(caseFile.auth.storageStatePath);
  }

  return contextOptions;
}

async function loginWithUi(caseFile: CaseFile, page: Page): Promise<void> {
  if (!caseFile.auth.username || !caseFile.auth.password) {
    throw new Error("UI auth requires auth.username and auth.password in the case file.");
  }

  await fillInput(page, '[data-test="signin-username"] input', caseFile.auth.username);
  await fillInput(page, '[data-test="signin-password"] input', caseFile.auth.password);
  await page.locator('[data-test="signin-submit"]').click();
  await page
    .locator('[data-test="transaction-list"], [data-test="user-onboarding-dialog"], [data-test="sidenav-toggle"]')
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function runWorkflow(caseFile: CaseFile, page: Page): Promise<void> {
  if (caseFile.workflow === "custom-script") {
    await runCustomWorkflow(caseFile, page);
    return;
  }

  if (caseFile.workflow === "crwa-mobile-onboarding-dialog") {
    await signUpAndOpenOnboarding(page);
    return;
  }

  if (caseFile.auth.mode === "ui") {
    await loginWithUi(caseFile, page);
  }

  if (caseFile.workflow === "crwa-mobile-date-range-drawer") {
    await page.locator('[data-test="transaction-list"]').waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('[data-test*="filter-date-range-button"]').first().click({ force: true });
    await page.locator('[data-test="date-range-filter-drawer"], .react-calendar').first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await page.waitForTimeout(600);
  }
}

async function runCustomWorkflow(caseFile: CaseFile, page: Page): Promise<void> {
  if (!caseFile.workflowScript) {
    throw new Error("custom-script workflow requires workflowScript in the case file.");
  }

  const moduleUrl = pathToFileURL(resolve(caseFile.workflowScript));
  moduleUrl.searchParams.set("t", String(Date.now()));
  const workflowModule = await import(moduleUrl.href) as {
    runWorkflow?: (page: Page, caseFile: CaseFile) => Promise<void>;
  };

  if (typeof workflowModule.runWorkflow !== "function") {
    throw new Error(`Workflow script ${caseFile.workflowScript} must export runWorkflow(page, caseFile).`);
  }

  await workflowModule.runWorkflow(page, caseFile);
}

export async function captureEvidence(caseFile: CaseFile): Promise<string> {
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const manifest = createPlannedArtifactManifest(caseFile);
  const redaction = createRedactionContext(caseFile.id);

  await mkdir(artifactDirectory, { recursive: true });
  await rm(resolve(artifactDirectory, "error.json"), { force: true });
  await writeRedactedJsonFile(manifest.files.input, caseFile, redaction);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(buildContextOptions(caseFile));
  const page = await context.newPage();

  const consoleMessages: NdjsonRecord[] = [];
  const networkRequests: NdjsonRecord[] = [];

  page.on("console", (message) => {
    consoleMessages.push(serializeConsoleMessage(message));
  });

  page.on("request", (request) => {
    networkRequests.push(serializeRequest(request));
  });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  try {
    const cdpSession = (await context.newCDPSession(page)) as CdpSession;
    await cdpSession.send("Accessibility.enable");

    const targetUrl = new URL(caseFile.route, caseFile.target.baseUrl).toString();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("body", { state: "visible", timeout: 15_000 });
    await runWorkflow(caseFile, page);

    await page.screenshot({ path: manifest.files.screenshot, fullPage: true });

    const axTree = await cdpSession.send("Accessibility.getFullAXTree");
    const domSnapshot = await cdpSession.send("DOMSnapshot.captureSnapshot", {
      computedStyles: ["display", "position", "z-index", "overflow", "opacity"],
      includeDOMRects: true,
      includePaintOrder: true,
    });

    await context.tracing.stop({ path: manifest.files.trace });

    await writeRedactedNdjsonFile(manifest.files.console, consoleMessages, redaction);
    await writeRedactedNdjsonFile(manifest.files.network, networkRequests, redaction);
    await writeRedactedJsonFile(manifest.files.axTree, axTree, redaction);
    await writeRedactedJsonFile(manifest.files.domSnapshot, domSnapshot, redaction);
    await writeRedactionReport(redaction, manifest.files.redactionReport);
    await writeFile(
      resolve(artifactDirectory, "manifest.json"),
      `${JSON.stringify({ ...manifest, status: "captured" }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    await page.screenshot({ path: manifest.files.screenshot, fullPage: true }).catch(() => undefined);
    await writeRedactedNdjsonFile(manifest.files.console, consoleMessages, redaction).catch(() => undefined);
    await writeRedactedNdjsonFile(manifest.files.network, networkRequests, redaction).catch(() => undefined);
    await writeRedactionReport(redaction, manifest.files.redactionReport).catch(() => undefined);
    await writeFile(
      resolve(artifactDirectory, "error.json"),
      `${JSON.stringify(
        {
          message: error instanceof Error ? error.message : String(error),
          caseId: caseFile.id,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }

  return artifactDirectory;
}

export async function captureNegativeControl(caseFile: CaseFile): Promise<string> {
  const manifest = createPlannedArtifactManifest(caseFile);

  return captureVerification(caseFile, {
    expectFailure: true,
    expectedFailures: caseFile.verification.negativeControl?.expectedFailures ?? [],
    outputPath: manifest.files.beforeVerify,
    screenshotPath: manifest.files.beforeVerifyScreenshot,
  });
}

export async function captureVerification(
  caseFile: CaseFile,
  options: VerificationCaptureOptions = {},
): Promise<string> {
  const artifactDirectory = resolve(caseFile.artifacts.directory);
  const manifest = createPlannedArtifactManifest(caseFile);
  const assertions: VerificationAssertion[] = [];
  const outputPath = options.outputPath ?? manifest.files.verify;
  const screenshotPath = options.screenshotPath ?? manifest.files.success;

  await mkdir(artifactDirectory, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(buildContextOptions(caseFile));
  const page = await context.newPage();
  const consoleErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  try {
    const targetUrl = new URL(caseFile.route, caseFile.target.baseUrl).toString();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("body", { state: "visible", timeout: 15_000 });
    await runWorkflow(caseFile, page);

    const viewport = page.viewportSize() ?? {
      width: caseFile.viewport.width,
      height: caseFile.viewport.height,
    };

    if (caseFile.verification.assertions?.length) {
      assertions.push(
        ...await runConfiguredAssertions(caseFile.verification.assertions, page, viewport, consoleErrors),
      );
    } else if (caseFile.workflow === "crwa-mobile-onboarding-dialog") {
      const dialog = page.locator('[data-test="user-onboarding-dialog"]').first();
      const logoutButton = page.locator('[data-test="user-onboarding-logout"]').first();
      const nextButton = page.locator('[data-test="user-onboarding-next"]').first();

      assertions.push(await assertVisible("onboarding dialog is visible", dialog));
      assertions.push(await assertVisible("logout button is visible", logoutButton));
      assertions.push(await assertVisible("next button is visible", nextButton));
      assertions.push(await assertInsideViewport("logout button is within the mobile viewport", logoutButton, viewport));
      assertions.push(await assertInsideViewport("next button is within the mobile viewport", nextButton, viewport));
      assertions.push(
        assertNoOverlap(
          "onboarding action buttons do not overlap",
          await logoutButton.boundingBox(),
          await nextButton.boundingBox(),
        ),
      );
      assertions.push(
        await assertNoHorizontalOverflow("onboarding step one does not introduce horizontal overflow", page),
      );
      assertions.push(
        assertNoConsoleRegression(
          "no unexpected console errors appear during onboarding verification",
          filterUnexpectedConsoleErrors(consoleErrors),
        ),
      );
    } else {
      const drawer = page.locator('[data-test="date-range-filter-drawer"]').first();
      const closeButton = page.locator('[data-test="date-range-filter-drawer-close"]').first();
      const calendar = page.locator('[data-test="transaction-list-filter-date-range"]').first();

      assertions.push(await assertVisible("date range drawer is visible", drawer));
      assertions.push(await assertVisible("drawer close button is visible", closeButton));
      assertions.push(await assertInsideViewport("calendar container is within the mobile viewport", calendar, viewport));
      assertions.push(
        assertNoConsoleRegression(
          "no unexpected console errors appear during drawer verification",
          filterUnexpectedConsoleErrors(consoleErrors),
        ),
      );
    }

    await page.screenshot({ path: screenshotPath, fullPage: false });

    const status = assertions.every((assertion) => assertion.pass) ? "passing" : "failing";
    const negativeControl = options.expectFailure
      ? buildNegativeControlResult(assertions, options.expectedFailures ?? [])
      : undefined;
    const result: VerificationResult = {
      caseId: caseFile.id,
      status,
      checkedAt: new Date().toISOString(),
      screenshot: screenshotPath,
      assertions,
      negativeControl,
    };

    await writeVerificationResult(artifactDirectory, manifest, outputPath, result);

    if (options.expectFailure) {
      if (negativeControl?.status !== "passing") {
        throw new Error(`Negative control failed for ${caseFile.id}. See ${outputPath}`);
      }
      return artifactDirectory;
    }

    if (status === "failing") {
      throw new Error(`Verification failed for ${caseFile.id}. See ${manifest.files.verify}`);
    }
  } catch (error) {
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    const negativeControl = options.expectFailure
      ? buildNegativeControlResult(assertions, options.expectedFailures ?? [])
      : undefined;
    await writeVerificationResult(artifactDirectory, manifest, outputPath, {
      caseId: caseFile.id,
      status: "failing",
      checkedAt: new Date().toISOString(),
      screenshot: screenshotPath,
      assertions,
      negativeControl,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }

  return artifactDirectory;
}

async function runConfiguredAssertions(
  contracts: VerificationAssertionContract[],
  page: Page,
  viewport: { width: number; height: number },
  consoleErrors: string[],
): Promise<VerificationAssertion[]> {
  const assertions: VerificationAssertion[] = [];

  for (const contract of contracts) {
    if (contract.type === "visible") {
      assertions.push(await assertVisible(contract.name, page.locator(contract.selector).first()));
      continue;
    }

    if (contract.type === "insideViewport") {
      assertions.push(await assertInsideViewport(contract.name, page.locator(contract.selector).first(), viewport));
      continue;
    }

    if (contract.type === "topWithin") {
      assertions.push(await assertTopWithin(contract.name, page.locator(contract.selector).first(), contract.maxY));
      continue;
    }

    if (contract.type === "widthAtLeast") {
      assertions.push(await assertWidthAtLeast(contract.name, page.locator(contract.selector).first(), contract.minWidth));
      continue;
    }

    if (contract.type === "noOverlap") {
      assertions.push(
        assertNoOverlap(
          contract.name,
          await page.locator(contract.targetSelector).first().boundingBox(),
          await page.locator(contract.blockerSelector).first().boundingBox(),
        ),
      );
      continue;
    }

    if (contract.type === "noHorizontalOverflow") {
      assertions.push(await assertNoHorizontalOverflow(contract.name, page));
      continue;
    }

    if (contract.type === "noConsoleRegression") {
      assertions.push(assertNoConsoleRegression(contract.name, filterUnexpectedConsoleErrors(consoleErrors)));
    }
  }

  return assertions;
}

async function writeVerificationResult(
  artifactDirectory: string,
  manifest: ReturnType<typeof createPlannedArtifactManifest>,
  outputPath: string,
  result: VerificationResult,
): Promise<void> {
  const redaction = createRedactionContext(result.caseId);

  await writeRedactedJsonFile(outputPath, result, redaction);
  await writeRedactionReport(redaction, manifest.files.redactionReport);
  await writeFile(
    resolve(artifactDirectory, "manifest.json"),
    `${JSON.stringify({ ...manifest, status: result.status }, null, 2)}\n`,
    "utf8",
  );
}

function buildNegativeControlResult(
  assertions: VerificationAssertion[],
  expectedFailures: string[],
): NegativeControlResult {
  const actualFailures = assertions
    .filter((assertion) => !assertion.pass)
    .map((assertion) => assertion.name);
  const matchedExpectedFailures = expectedFailures.filter((expected) =>
    actualFailures.some((actual) => assertionNameMatches(actual, expected))
  );
  const missingExpectedFailures = expectedFailures.filter((expected) =>
    !matchedExpectedFailures.some((matched) => assertionNameMatches(matched, expected))
  );
  const additionalFailures = actualFailures.filter((actual) =>
    !expectedFailures.some((expected) => assertionNameMatches(actual, expected))
  );
  const status =
    expectedFailures.length > 0
      ? missingExpectedFailures.length === 0
      : actualFailures.length > 0;

  return {
    status: status ? "passing" : "failing",
    expectedFailures,
    actualFailures,
    matchedExpectedFailures,
    missingExpectedFailures,
    additionalFailures,
  };
}

function assertionNameMatches(actual: string, expected: string): boolean {
  const normalizedActual = actual.trim().toLowerCase();
  const normalizedExpected = expected.trim().toLowerCase();

  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
  );
}

async function signUpAndOpenOnboarding(page: Page): Promise<void> {
  const generatedUser = createGeneratedUser();

  await page.locator('[data-test="signup-title"]').waitFor({ state: "visible", timeout: 15_000 });
  await fillInput(page, '[data-test="signup-first-name"] input', generatedUser.firstName);
  await fillInput(page, '[data-test="signup-last-name"] input', generatedUser.lastName);
  await fillInput(page, '[data-test="signup-username"] input', generatedUser.username);
  await fillInput(page, '[data-test="signup-password"] input', generatedUser.password);
  await fillInput(page, '[data-test="signup-confirmPassword"] input', generatedUser.password);
  await page.locator('[data-test="signup-submit"]').click();

  await page.locator('[data-test="signin-username"] input').waitFor({ state: "visible", timeout: 30_000 });
  await fillInput(page, '[data-test="signin-username"] input', generatedUser.username);
  await fillInput(page, '[data-test="signin-password"] input', generatedUser.password);
  await page.locator('[data-test="signin-submit"]').click();
  await page.locator('[data-test="user-onboarding-dialog"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-test="user-onboarding-next"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(600);
}

async function fillInput(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).fill(value);
}

function createGeneratedUser(): GeneratedUser {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)
    .toString()
    .padStart(3, "0")}`;

  return {
    firstName: "Surgeon",
    lastName: suffix.slice(-6),
    username: `surgeon_${suffix}`,
    password: "s3cret",
  };
}

function filterUnexpectedConsoleErrors(consoleErrors: string[]): string[] {
  return consoleErrors.filter((entry) =>
    !KNOWN_CONSOLE_NOISE_PATTERNS.some((pattern) => pattern.test(entry))
  );
}
