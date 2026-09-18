#!/usr/bin/env node
/**
 * Renders the app against the emulators and writes PNGs to ./shots.
 * Used to eyeball the design in both themes and at phone width.
 *
 *   node scripts/screenshots.mjs
 */

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = "shots";

mkdirSync(OUT, { recursive: true });

// The sandbox ships a Chromium that may not match the bundled Playwright
// revision, so point at it explicitly when it is there.
const EXE = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});

async function shot(name, path, { theme = "light", width = 1280, height = 1000 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console] ${m.text().slice(0, 160)}`);
  });
  // domcontentloaded, not networkidle: the Google Fonts request can hang in
  // a sandboxed network and networkidle would never fire.
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" });
  // Let the Firestore snapshot land and the skeletons swap out.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`  wrote ${OUT}/${name}.png`);
  await ctx.close();
}

console.log("\ncapturing…");
await shot("board-light", "/");
await shot("board-dark", "/", { theme: "dark" });
await shot("roadmap-light", "/roadmap", { width: 1440 });
await shot("roadmap-dark", "/roadmap", { theme: "dark", width: 1440 });
await shot("board-mobile", "/", { width: 390, height: 844 });

// Deep-link into whichever ticket the seed put first.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const href = await page.locator('a[href^="/p/"]').first().getAttribute("href");
await ctx.close();
if (href) {
  await shot("detail-light", href);
  await shot("detail-dark", href, { theme: "dark" });
}

await browser.close();
console.log("done\n");
