import { type Locator, type Page } from "@playwright/test";

export type VerificationAssertion = {
  name: string;
  pass: boolean;
  expected: string;
  actual: unknown;
};

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function assertVisible(name: string, locator: Locator): Promise<VerificationAssertion> {
  const pass = await locator.isVisible();

  return {
    name,
    pass,
    expected: "element visible",
    actual: "visible check completed",
  };
}

export async function assertInsideViewport(
  name: string,
  locator: Locator,
  viewport: { width: number; height: number },
): Promise<VerificationAssertion> {
  const box = await locator.boundingBox();

  return {
    name,
    pass: Boolean(box && isWithinViewport(box, viewport)),
    expected: `x/y bounds within ${viewport.width}x${viewport.height}`,
    actual: box,
  };
}

export async function assertTopWithin(
  name: string,
  locator: Locator,
  maxY: number,
): Promise<VerificationAssertion> {
  const box = await locator.boundingBox();

  return {
    name,
    pass: Boolean(box && box.y <= maxY),
    expected: `element top y <= ${maxY}`,
    actual: box,
  };
}

export async function assertWidthAtLeast(
  name: string,
  locator: Locator,
  minWidth: number,
): Promise<VerificationAssertion> {
  const box = await locator.boundingBox();

  return {
    name,
    pass: Boolean(box && box.width >= minWidth),
    expected: `element width >= ${minWidth}`,
    actual: box,
  };
}

export function assertNoOverlap(
  name: string,
  targetBox: Box | null,
  blockerBox: Box | null,
): VerificationAssertion {
  return {
    name,
    pass: Boolean(targetBox && blockerBox && !boxesOverlap(targetBox, blockerBox)),
    expected: "boxes do not overlap",
    actual: { targetBox, blockerBox },
  };
}

export function assertNoConsoleRegression(
  name: string,
  consoleErrors: string[],
): VerificationAssertion {
  return {
    name,
    pass: consoleErrors.length === 0,
    expected: "no console errors during verification run",
    actual: consoleErrors,
  };
}

export async function assertNoHorizontalOverflow(
  name: string,
  page: Page,
): Promise<VerificationAssertion> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  return {
    name,
    pass: metrics.scrollWidth <= metrics.innerWidth + 1,
    expected: "document scrollWidth <= viewport width",
    actual: metrics,
  };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function isWithinViewport(box: Box, viewport: { width: number; height: number }): boolean {
  const tolerance = 1;
  return (
    box.x >= -tolerance &&
    box.y >= -tolerance &&
    box.x + box.width <= viewport.width + tolerance &&
    box.y + box.height <= viewport.height + tolerance
  );
}
