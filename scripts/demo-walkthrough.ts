/**
 * Auto-driven walkthrough of the deployed cockpit.
 *
 * Two modes:
 *
 *   pnpm demo:walkthrough --auto   # silent, no narration needed.
 *                                  # Hit record on your screen recorder,
 *                                  # run this, walk away. ~85 seconds.
 *                                  # Renders intro and outro text cards
 *                                  # so the video tells its own story.
 *
 *   pnpm demo:walkthrough          # interactive. Press ENTER between
 *                                  # beats while you narrate live. See
 *                                  # documents/video/script.md.
 *
 * Add --local to drive the local artifacts/index.html instead of the
 * live deploy.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { chromium, type Page } from "@playwright/test";

const LIVE_BASE = "https://forensic-cockpit.vercel.app";
const LOCAL_INDEX = "artifacts/index.html";

type Beat = {
  label: string;
  prompt: string;
  autoHoldMs: number;
  run: (page: Page, base: string) => Promise<void>;
};

const beats: Beat[] = [
  {
    label: "B1 Hero",
    prompt: "Hero with twin scorecards (fixture 100, model 100).",
    autoHoldMs: 9000,
    run: async (page, base) => {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    },
  },
  {
    label: "B2 Model Authorship — Drawer (passing model patch)",
    prompt: "Opus 4.7 ran inside the target repo. 6 turns, 1 file edited, $0.22.",
    autoHoldMs: 11000,
    run: async (page) => {
      await smoothScrollToText(page, "Model Authorship — Date Range Drawer");
    },
  },
  {
    label: "B3 Per-case dossier — proof gates",
    prompt: "11 deterministic proof gates. Same gates that grade the human fix.",
    autoHoldMs: 9000,
    run: async (page, base) => {
      await page.goto(`${base}/crwa-mobile-date-range-drawer/index.html`, { waitUntil: "domcontentloaded" });
      await smoothScrollToText(page, "Proof Gates");
    },
  },
  {
    label: "B4 Agent Timeline (Opus's actual reasoning)",
    prompt: "Real agent transcript: Read, Edit, the diagnosis Turn 4.",
    autoHoldMs: 11000,
    run: async (page) => {
      await smoothScrollToText(page, "Agent Timeline");
    },
  },
  {
    label: "B5 Failing case (honest counterexample)",
    prompt: "Same architecture, second bug. Model's patch failed verification. Score 92.",
    autoHoldMs: 11000,
    run: async (page, base) => {
      await page.goto(`${base}/crwa-mobile-onboarding-dialog/index.html`, { waitUntil: "domcontentloaded" });
      await smoothScrollToText(page, "Model Authorship — Claude Code Agent Loop");
    },
  },
  {
    label: "B6 Honest Scope + Capability Pipeline",
    prompt: "The architecture: case contracts, target adapters, deterministic verifier.",
    autoHoldMs: 9000,
    run: async (page, base) => {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await smoothScrollToText(page, "Honest Scope");
    },
  },
];

const INTRO_HTML = `
  <div id="surgeon-overlay" style="
    position: fixed; inset: 0;
    background: #0f0d0a;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    color: #f5e9d4;
    font-family: 'Iowan Old Style', 'Apple Garamond', Georgia, 'Times New Roman', serif;
    z-index: 999999;
    text-align: center; padding: 48px;
    transition: opacity 600ms ease-out;
  ">
    <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #b8a888; margin-bottom: 32px;">
      Built with Opus 4.7 / Claude Code Hackathon
    </div>
    <div style="font-size: 88px; line-height: 1.05; max-width: 1100px; font-weight: 700;">
      Forensic Repo Surgeon
    </div>
    <div style="font-size: 32px; line-height: 1.3; margin-top: 28px; color: #d6c5a3; font-style: italic;">
      Models propose. Verifiers decide.
    </div>
    <div style="font-size: 18px; line-height: 1.5; margin-top: 56px; max-width: 900px; color: #b8a888;">
      A portable proof contract for AI-authored frontend repairs.<br/>
      Two real Opus 4.7 patches. One verifier. One pass, one honest fail.
    </div>
  </div>
`;

const OUTRO_HTML = `
  <div id="surgeon-overlay" style="
    position: fixed; inset: 0;
    background: #0f0d0a;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    color: #f5e9d4;
    font-family: 'Iowan Old Style', 'Apple Garamond', Georgia, 'Times New Roman', serif;
    z-index: 999999;
    text-align: center; padding: 48px;
    transition: opacity 600ms ease-out;
  ">
    <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #b8a888; margin-bottom: 32px;">
      Live cockpit · every artifact browsable
    </div>
    <div style="font-size: 64px; line-height: 1.1; color: #f5e9d4; font-weight: 700;">
      forensic-cockpit.vercel.app
    </div>
    <div style="font-size: 20px; line-height: 1.5; margin-top: 56px; max-width: 880px; color: #d6c5a3;">
      Every diff is real. Every cost is real. Every redaction passed.<br/>
      Built with Opus 4.7 — Claude Code authored the agent loop too.
    </div>
  </div>
`;

async function showOverlay(page: Page, html: string, holdMs: number): Promise<void> {
  await page.evaluate((h) => {
    const existing = document.getElementById("surgeon-overlay");
    if (existing) existing.remove();
    const wrap = document.createElement("div");
    wrap.innerHTML = h;
    document.body.appendChild(wrap.firstElementChild!);
  }, html);
  await page.waitForTimeout(holdMs);
}

async function fadeOutOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById("surgeon-overlay");
    if (el) {
      (el as HTMLElement).style.opacity = "0";
      setTimeout(() => el.remove(), 700);
    }
  });
  await page.waitForTimeout(800);
}

async function smoothScrollToText(page: Page, text: string): Promise<void> {
  await page.evaluate((needle: string) => {
    const all = Array.from(document.body.querySelectorAll<HTMLElement>("h1, h2, h3"));
    const target = all.find((el) => el.textContent?.trim().includes(needle));
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - 120;
    window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
  }, text);
  await page.waitForTimeout(900);
}

async function runAuto(page: Page, base: string): Promise<void> {
  console.log("\n[auto] intro card 4s...");
  // Navigate first so the overlay has a page to overlay onto.
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await showOverlay(page, INTRO_HTML, 4000);
  await fadeOutOverlay(page);

  for (const beat of beats) {
    console.log(`[auto] ${beat.label}  (hold ${beat.autoHoldMs}ms)`);
    await beat.run(page, base);
    await page.waitForTimeout(beat.autoHoldMs);
  }

  console.log("[auto] outro card 6s...");
  await showOverlay(page, OUTRO_HTML, 6000);

  console.log("\n[auto] DONE. Stop your screen recorder.");
}

async function runInteractive(page: Page, base: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    for (const beat of beats) {
      console.log("\n----------------------------------------------------------");
      console.log(`>>> ${beat.label}`);
      console.log(`    ${beat.prompt}`);
      await beat.run(page, base);
      await rl.question("    ENTER to advance > ");
    }
    console.log("\nDone. Stop your screen recorder and trim to under 3 minutes.");
  }
  finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const useLocal = process.argv.includes("--local");
  const auto = process.argv.includes("--auto");
  const base = useLocal ? pathToFileURL(resolve(LOCAL_INDEX)).toString().replace(/\/index\.html$/, "") : LIVE_BASE;

  console.log("");
  console.log("==========================================================");
  console.log(" Forensic Repo Surgeon — Demo Walkthrough");
  console.log("==========================================================");
  console.log(` mode: ${auto ? "auto (silent, ~85s, hit record and walk away)" : "interactive (press ENTER between beats)"}`);
  console.log(` base: ${base}`);
  console.log("");

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    if (auto) {
      await runAuto(page, base);
      // Hold the final outro for an extra beat so the screen recorder
      // captures it cleanly even if the user is slow to stop recording.
      await page.waitForTimeout(2000);
    }
    else {
      await runInteractive(page, base);
    }
  }
  finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
