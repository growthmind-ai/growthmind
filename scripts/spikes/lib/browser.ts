import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENV_VARS } from "./constants";

const WINDOWS_RELATIVE_PATHS = [
  join("Google", "Chrome", "Application", "chrome.exe"),
  join("Microsoft", "Edge", "Application", "msedge.exe"),
  join("Chromium", "Application", "chrome.exe"),
] as const;

const WINDOWS_DEFAULT_BASES = ["C:\\Program Files", "C:\\Program Files (x86)"] as const;

const MACOS_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
] as const;

const LINUX_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
] as const;

function windowsCandidates(env: Record<string, string | undefined>): string[] {
  const bases = new Set<string>(WINDOWS_DEFAULT_BASES);
  for (const key of ["ProgramFiles", "PROGRAMFILES", "ProgramFiles(x86)"]) {
    const value = env[key];
    if (value !== undefined && value !== "") bases.add(value);
  }
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData !== undefined && localAppData !== "") {
    bases.add(localAppData);
  }
  const candidates: string[] = [];
  for (const base of bases) {
    for (const relative of WINDOWS_RELATIVE_PATHS) {
      candidates.push(join(base, relative));
    }
  }
  return candidates;
}

export function findBrowser(env: Record<string, string | undefined>): string | null {
  const override = env[ENV_VARS.CHROME_PATH];
  if (override !== undefined && override !== "" && existsSync(override)) {
    return override;
  }

  const candidates = [...windowsCandidates(env), ...MACOS_PATHS, ...LINUX_PATHS];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type RecordingTrialResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runRecordingTrial(
  browserPath: string,
  pageUrl: string,
  durationMs: number,
): Promise<RecordingTrialResult> {
  let userDataDir: string;
  try {
    userDataDir = mkdtempSync(join(tmpdir(), "gm-spike-"));
  } catch (error) {
    return { ok: false, reason: `temp dir creation failed: ${errorMessage(error)}` };
  }

  try {
    const proc = Bun.spawn(
      [
        browserPath,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${userDataDir}`,
        pageUrl,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );

    await new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs);
    });

    try {
      proc.kill();
    } catch {
      // Already exited, the point was that it stops; nothing to do.
    }
    try {
      await proc.exited;
    } catch {
      // Exit-status errors don't matter; the trial ran for its duration.
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `browser spawn failed: ${errorMessage(error)}` };
  } finally {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup, Windows file locks can hold the profile dir.
    }
  }
}
