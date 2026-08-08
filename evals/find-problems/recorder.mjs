// Runs under Node, never bun: Playwright's pipe transport needs child_process stdio fds
// that bun does not wire on Windows, so a bun-hosted launch hangs at the CDP handshake.
// Everything downstream of the events this writes runs under bun on the production path.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { chromium } from "playwright-core";

import { RECORD_INIT_SCRIPT } from "./browser.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const url = arg("url", "http://localhost:3000/sign-in");
const out = arg("out", "runs/session.json");
const width = Number(arg("width", "1280"));
const height = Number(arg("height", "800"));
const planPath = arg("plan", null);

const plan = planPath ? JSON.parse(readFileSync(planPath, "utf8")) : { steps: [] };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.addInitScript(RECORD_INIT_SCRIPT);

const performed = [];

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  for (const step of plan.steps) {
    try {
      if (step.action === "click") {
        await page.locator(step.selector).first().click({ timeout: 4000 });
      } else if (step.action === "type") {
        const field = page.locator(step.selector).first();
        await field.click({ timeout: 4000 });
        await field.type(step.text, { delay: 55 });
      } else if (step.action === "scroll") {
        await page.mouse.wheel(0, step.by ?? 600);
      } else if (step.action === "wait") {
        await page.waitForTimeout(step.ms ?? 800);
      }
      performed.push({ ...step, ok: true });
    } catch (error) {
      performed.push({ ...step, ok: false, error: String(error).split("\n")[0] });
    }
    await page.waitForTimeout(500);
  }

  const recordError = await page.evaluate(() => window.__gmRecordError ?? null);
  const events = await page.evaluate(() => window.__gmEvents ?? []);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify({ url, finalUrl: page.url(), recordError, consoleErrors, performed, events }),
  );

  process.stdout.write(
    `recorded ${String(events.length)} events -> ${out} (final ${page.url()})\n`,
  );
  if (recordError) process.stdout.write(`rrweb error: ${recordError}\n`);
} finally {
  await browser.close();
}
