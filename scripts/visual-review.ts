#!/usr/bin/env node
/**
 * Runs under Node (node --version >= 22.18), not Bun: Playwright's stdio-pipe
 * transport to Chromium never connects under Bun on Windows — the browser
 * launches, the CDP handshake times out.
 *
 * Visual-review gate (pr-readiness gate 3): screenshots the pages in the
 * diff's blast radius in both color schemes for a vision-capable reviewer.
 *
 * Usage:
 *   bun run visual-review                             # pages from git diff, light + dark
 *   node scripts/visual-review.ts --pages /,/settings
 *   node scripts/visual-review.ts --schemes light
 *   node scripts/visual-review.ts --no-auth
 *
 * Drives the system Chrome/Edge via playwright-core — no browser download.
 * Signs up a throwaway account so pages behind the (app) auth wall render the
 * real shell instead of the sign-in redirect.
 *
 * Screenshots: .ai/audits/visual/[timestamp]/[scheme][route].png
 * Exit code: 0 = captured, 1 = fail, 2 = skipped (no .tsx/.css in diff)
 */
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { chromium, type Browser } from "playwright-core";

const DEV_PORT = Number(process.env.PORT) || 3000;
const BASE_URL = `http://localhost:${DEV_PORT}`;
const SERVER_POLL_TIMEOUT_MS = 120_000;
const NAV_TIMEOUT_MS = 150_000;
const SETTLE_MS = 750;
const SCHEME_STORAGE_KEY = "mantine-color-scheme-value";
const VISUAL_FILE = /\.(tsx|css)$/;

type Scheme = "light" | "dark";

interface Capture {
  path: string;
  scheme: Scheme;
  status: "pass" | "fail";
  file?: string;
  final_url?: string;
  applied_scheme?: string;
  error?: string;
}

interface VisualReport {
  timestamp: string;
  status: "pass" | "fail";
  base_url: string;
  authenticated: boolean;
  captures: Capture[];
  console_errors: string[];
  summary: string;
}

interface Args {
  pages: string[] | null;
  schemes: Scheme[];
  auth: boolean;
}

// Git Bash on Windows expands a leading "/route" to "C:/Program Files/Git/route"
// (same hazard validate-runtime.ts guards against).
function normalizeRoutePath(p: string): string {
  if (p.startsWith("/")) return p;
  const match = p.replace(/\\/g, "/").match(/^[A-Za-z]:\/[^/]+\/[^/]+\/(.*)$/);
  if (match) return `/${match[1]}`;
  return p;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { pages: null, schemes: ["light", "dark"], auth: true };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pages" && argv[i + 1]) {
      args.pages = argv[i + 1]
        .split(",")
        .map((p) => normalizeRoutePath(p.trim()))
        .filter(Boolean);
      i++;
    } else if (argv[i] === "--schemes" && argv[i + 1]) {
      args.schemes = argv[i + 1]
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is Scheme => s === "light" || s === "dark");
      i++;
    } else if (argv[i] === "--no-auth") {
      args.auth = false;
    }
  }
  return args;
}

function changedFiles(): string[] {
  const range = spawnSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
    encoding: "utf-8",
  });
  if (range.status === 0) return range.stdout.split("\n").filter(Boolean);
  const local = spawnSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf-8" });
  if (local.status !== 0) return [];
  return local.stdout.split("\n").filter(Boolean);
}

function routesFrom(files: string[]): string[] {
  const routes = new Set<string>();
  for (const file of files) {
    const match = file.match(/^(?:apps\/web\/)?app\/(.+)\/page\.(tsx|jsx|ts|js)$/);
    if (!match) continue;
    const segments = match[1].split("/").filter((seg) => !/^\(.+\)$/.test(seg));
    const route = "/" + segments.join("/");
    if (!route.includes("[")) routes.add(route);
  }
  return Array.from(routes);
}

async function serverUp(): Promise<boolean> {
  try {
    await fetch(BASE_URL, { signal: AbortSignal.timeout(3_000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

async function startDevServer(): Promise<ChildProcess> {
  const proc = spawn("bun run dev", {
    shell: true,
    env: { ...process.env, PORT: String(DEV_PORT) },
    stdio: "ignore",
  });

  const deadline = Date.now() + SERVER_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await serverUp()) return proc;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  stopDevServer(proc);
  throw new Error(`Dev server did not respond within ${SERVER_POLL_TIMEOUT_MS / 1000}s`);
}

function stopDevServer(proc: ChildProcess): void {
  // Plain kill leaves the next-server grandchild alive on Windows.
  if (process.platform === "win32" && proc.pid !== undefined) {
    spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    proc.kill("SIGTERM");
  } catch {}
}

interface SessionCookie {
  name: string;
  value: string;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Better Auth only accepts POSTs whose Origin matches BETTER_AUTH_URL, which in
// dev may be an ngrok tunnel rather than localhost.
function resolveTrustedOrigin(): string {
  const fromEnv = process.env.BETTER_AUTH_URL;
  if (fromEnv !== undefined && fromEnv !== "") return originOf(fromEnv) ?? BASE_URL;
  for (const file of ["apps/web/.env.local", "apps/web/.env", ".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf-8").match(/^\s*BETTER_AUTH_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match?.[1]) return originOf(match[1].trim()) ?? BASE_URL;
  }
  return BASE_URL;
}

async function signUpThrowaway(): Promise<SessionCookie[] | null> {
  // The auth route cold-compiles on first hit and can reset the socket mid-request.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const cookies = await signUpOnce();
    if (cookies !== null) return cookies;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return null;
}

async function signUpOnce(): Promise<SessionCookie[] | null> {
  const stamp = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: resolveTrustedOrigin() },
      body: JSON.stringify({
        name: "Visual Review",
        email: `visual-review-${stamp}@example.com`,
        password: `vr-${stamp}-secret`,
      }),
    });
    if (!res.ok) {
      console.log(
        `[visual] sign-up failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
      return null;
    }
    const cookies = res.headers
      .getSetCookie()
      .map((raw) => {
        const pair = raw.split(";")[0] ?? "";
        const eq = pair.indexOf("=");
        return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
      })
      .filter((c) => c.name !== "" && c.value !== "");
    return cookies.length > 0 ? cookies : null;
  } catch (err) {
    console.log(`[visual] sign-up failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function launchBrowser(): Promise<Browser> {
  let lastError = "";
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ channel, headless: true, timeout: 60_000 });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`No Chrome or Edge available: ${lastError}`);
}

function fileNameFor(path: string, scheme: Scheme): string {
  return `${scheme}${path === "/" ? "-home" : path.replace(/\//g, "-")}.png`;
}

async function captureScheme(
  browser: Browser,
  scheme: Scheme,
  pages: string[],
  cookies: SessionCookie[] | null,
  authExpected: boolean,
  outDir: string,
  consoleErrors: string[],
): Promise<Capture[]> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(SCHEME_STORAGE_KEY)}, ${JSON.stringify(scheme)})`,
  );
  if (cookies !== null) {
    await context.addCookies(cookies.map((c) => ({ ...c, domain: "localhost", path: "/" })));
  }

  const captures: Capture[] = [];
  const page = await context.newPage();
  page.on("pageerror", (err) => consoleErrors.push(`[${scheme}] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[${scheme}] ${msg.text().slice(0, 300)}`);
  });

  for (const path of pages) {
    try {
      await page.goto(path, { timeout: NAV_TIMEOUT_MS, waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);

      // A string expression, not a closure — the scripts tsconfig has no DOM lib.
      const applied =
        ((await page.evaluate(
          'document.documentElement.getAttribute("data-mantine-color-scheme")',
        )) as string | null) ?? "missing";
      const finalUrl = page.url();
      const file = join(outDir, fileNameFor(path, scheme));
      await page.screenshot({ path: file, fullPage: true });

      const redirectedToAuth = authExpected && finalUrl.includes("/sign-in") && path !== "/sign-in";
      const capture: Capture = {
        path,
        scheme,
        status: redirectedToAuth || applied !== scheme ? "fail" : "pass",
        file,
        final_url: finalUrl,
        applied_scheme: applied,
      };
      if (redirectedToAuth) capture.error = "authenticated request redirected to sign-in";
      else if (applied !== scheme) capture.error = `page rendered scheme "${applied}"`;
      captures.push(capture);
      console.log(`[visual] ${capture.status.toUpperCase()} ${scheme} ${path} → ${file}`);
    } catch (err) {
      captures.push({
        path,
        scheme,
        status: "fail",
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`[visual] FAIL ${scheme} ${path}: ${captures.at(-1)?.error}`);
    }
  }

  await context.close();
  return captures;
}

function writeReport(report: VisualReport, outDir: string): string {
  const reportPath = join(outDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  return reportPath;
}

async function main(): Promise<void> {
  const args = parseArgs();

  let pages = args.pages;
  if (pages === null) {
    const files = changedFiles();
    if (!files.some((f) => VISUAL_FILE.test(f))) {
      console.log("[visual] SKIPPED: no .tsx/.css in diff — nothing to review");
      process.exit(2);
    }
    pages = Array.from(new Set(["/", ...routesFrom(files)]));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), ".ai", "audits", "visual", stamp);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(`[visual] Pages: ${pages.join(", ")} | Schemes: ${args.schemes.join(", ")}`);

  const reusingServer = await serverUp();
  let devProc: ChildProcess | null = null;
  if (!reusingServer) {
    console.log("[visual] Starting dev server…");
    devProc = await startDevServer();
  }

  const report: VisualReport = {
    timestamp: new Date().toISOString(),
    status: "pass",
    base_url: BASE_URL,
    authenticated: false,
    captures: [],
    console_errors: [],
    summary: "",
  };

  let browser: Browser | null = null;
  try {
    const cookies = args.auth ? await signUpThrowaway() : null;
    report.authenticated = cookies !== null;
    if (args.auth && cookies === null) {
      report.status = "fail";
      report.summary = "sign-up failed — app pages would capture the sign-in redirect";
    }

    browser = await launchBrowser();
    for (const scheme of args.schemes) {
      report.captures.push(
        ...(await captureScheme(
          browser,
          scheme,
          pages,
          cookies,
          args.auth,
          outDir,
          report.console_errors,
        )),
      );
    }
    if (report.captures.some((c) => c.status === "fail")) report.status = "fail";
  } catch (err) {
    report.status = "fail";
    report.summary = err instanceof Error ? err.message : String(err);
  } finally {
    if (browser !== null) await browser.close();
    if (devProc !== null) stopDevServer(devProc);
  }

  if (report.summary === "") {
    const failed = report.captures.filter((c) => c.status === "fail").length;
    report.summary =
      report.status === "pass"
        ? `${report.captures.length} screenshots captured — review them before declaring PASS`
        : `${failed}/${report.captures.length} captures failed`;
  }

  const reportPath = writeReport(report, outDir);
  console.log(`[visual] ${report.status.toUpperCase()}: ${report.summary}`);
  console.log(`[visual] Screenshots: ${outDir}`);
  console.log(`[visual] Report: ${reportPath}`);
  process.exit(report.status === "pass" ? 0 : 1);
}

main().catch((err) => {
  console.error("[visual] Fatal:", err);
  process.exit(1);
});
