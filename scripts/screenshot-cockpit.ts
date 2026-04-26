/**
 * Quick utility to render a screenshot of the demo cockpit and the
 * per-case dossier. Used at submission time to update preview images
 * inside the static export package.
 *
 * Run with:
 *   tsx scripts/screenshot-cockpit.ts
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

// Anthropic's API rejects images with any dimension > 8000px. We clip below
// that so previews are safe to attach in chat / embed in pitch decks.
const MAX_DIMENSION = 7800;

const TARGETS: Array<{ html: string; out: string; viewport?: { width: number; height: number } }> = [
  {
    html: "artifacts/index.html",
    out: "artifacts/demo-cockpit-preview.png",
    viewport: { width: 1280, height: 1800 },
  },
  {
    html: "artifacts/crwa-mobile-date-range-drawer/index.html",
    out: "artifacts/crwa-mobile-date-range-drawer/viewer-preview.png",
    viewport: { width: 1280, height: 2000 },
  },
  {
    html: "artifacts/crwa-mobile-onboarding-dialog/index.html",
    out: "artifacts/crwa-mobile-onboarding-dialog/viewer-preview.png",
    viewport: { width: 1280, height: 2000 },
  },
];

async function main(): Promise<void> {
  const browser = await chromium.launch();
  for (const target of TARGETS) {
    const htmlPath = resolve(target.html);
    const outPath = resolve(target.out);
    await mkdir(dirname(outPath), { recursive: true });
    const context = await browser.newContext({
      viewport: target.viewport ?? { width: 1280, height: 1800 },
    });
    const page = await context.newPage();
    try {
      await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);

      // Measure full document height. If it's safely under MAX_DIMENSION on
      // both axes, take a normal fullPage screenshot. Otherwise resize the
      // viewport to MAX_DIMENSION (so Playwright paints all the way down) and
      // take a clipped screenshot so neither axis exceeds Anthropic's 8000px
      // image limit. This keeps previews safe to embed/attach without tripping
      // `image dimensions exceed max allowed size`.
      const docSize = await page.evaluate(() => ({
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      }));
      const oversize = docSize.height > MAX_DIMENSION || docSize.width > MAX_DIMENSION;

      if (!oversize) {
        await page.screenshot({ path: outPath, fullPage: true });
        console.log(`Wrote screenshot to ${outPath} [${docSize.width}x${docSize.height}]`);
      } else {
        const viewportWidth = target.viewport?.width ?? 1280;
        const clipWidth = Math.min(docSize.width || viewportWidth, MAX_DIMENSION);
        const clipHeight = Math.min(docSize.height, MAX_DIMENSION);
        // Resize so the layout actually paints inside the clip region.
        await page.setViewportSize({ width: clipWidth, height: clipHeight });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: outPath,
          clip: { x: 0, y: 0, width: clipWidth, height: clipHeight },
        });
        console.log(`Wrote screenshot to ${outPath} [${clipWidth}x${clipHeight}] (clipped from ${docSize.width}x${docSize.height})`);
      }
    }
    finally {
      await context.close();
    }
  }
  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
