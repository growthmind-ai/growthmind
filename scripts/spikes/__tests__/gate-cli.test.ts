// Wave 1 red integration tests for the credential gate at the CLI boundary (Wave 0
// "Integration tests", Human Acceptance Test Part A). Spawns the real entrypoint with a
// scrubbed env. Network-free by construction: the gate exits before any network call or
// filesystem write. The entrypoint is currently a stub printing "not implemented" →
// these tests must fail (message assertions) until Wave 4 implements the gate.

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { ENV_VARS, REQUIRED_ENV_VARS } from "../lib/constants";

/** Repo root: __tests__ → spikes → scripts → root. */
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

const ENTRYPOINT = join("scripts", "spikes", "m0-posthog-latency.ts");

const LOCAL_SPIKES_DIR = join(REPO_ROOT, "local", "spikes");

/**
 * An env file that defines nothing. bun auto-loads the repo-root `.env` into any
 * process it spawns, which would re-inject the POSTHOG_* credentials that scrubbedEnv
 * just removed. Making these tests pass only on a machine without a configured `.env`.
 * Pointing `--env-file` here suppresses that default load, so the gate genuinely sees
 * no credentials either way.
 */
const NO_VARS_ENV_FILE = join(import.meta.dir, "fixtures", "no-vars.env");

/** Generous: bun spawning bun is slow on Windows, especially first run. */
const SPAWN_TIMEOUT_MS = 60_000;

/**
 * Minimal safe env: copy of process.env (path, SystemRoot, etc. Bun itself must still
 * run on Windows) with every POSTHOG_* key deleted. Windows env keys are
 * case-insensitive, so match case-insensitively.
 */
function scrubbedEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith("POSTHOG_")) delete env[key];
  }
  return env;
}

/** Sorted listing of local/spikes/; tolerates the directory being absent. */
function listLocalSpikes(): string[] {
  try {
    return readdirSync(LOCAL_SPIKES_DIR).toSorted();
  } catch {
    return []; // dir absent — nothing written yet, which is the point
  }
}

async function runEntrypoint(env: Record<string, string | undefined>): Promise<{
  exitCode: number;
  combined: string;
}> {
  const proc = Bun.spawn([process.execPath, `--env-file=${NO_VARS_ENV_FILE}`, ENTRYPOINT], {
    cwd: REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { exitCode, combined: `${stdout}\n${stderr}` };
}

/**
 * The "missing enumeration" of the gate's output: the paragraph (contiguous non-blank
 * lines) starting at the first line matching /missing/i. Guidance paragraphs after a
 * blank line may mention other variables; this section may not. Falls back to the whole
 * output if no line says "missing". A gate that never says "missing" gets the strict
 * whole-output check.
 */
function missingEnumeration(output: string): string {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => /missing/i.test(line));
  if (start === -1) return output;
  const rest = lines.slice(start);
  const end = rest.findIndex((line) => line.trim() === "");
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("m0-posthog-latency credential gate (CLI)", () => {
  test(
    "entrypoint exits non-zero naming all four variables when env has none, before any network call",
    async () => {
      const before = listLocalSpikes();

      const { exitCode, combined } = await runEntrypoint(scrubbedEnv());

      // Gate failure, not success.
      expect(exitCode).not.toBe(0);

      // All four variables named in plain English.
      for (const name of REQUIRED_ENV_VARS) {
        expect(combined).toContain(name);
      }

      // No raw stack trace. The entrypoint formats expected failures.
      expect(combined).not.toMatch(/\n\s+at /);

      // Exit before any filesystem write: local/spikes/ gained no file.
      expect(listLocalSpikes()).toEqual(before);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "entrypoint names exactly the one missing variable when three are set to dummies",
    async () => {
      // Dummy values never reach the network: the gate fails on the absent fourth
      // variable before any request is constructed.
      const env = scrubbedEnv();
      env[ENV_VARS.POSTHOG_HOST] = "https://dummy.example";
      env[ENV_VARS.POSTHOG_PROJECT_API_KEY] = "phc_dummy";
      env[ENV_VARS.POSTHOG_PERSONAL_API_KEY] = "phx_dummy";
      // POSTHOG_PROJECT_ID stays deleted.

      const { exitCode, combined } = await runEntrypoint(env);

      expect(exitCode).not.toBe(0);

      // The missing enumeration flags POSTHOG_PROJECT_ID and only it. The wider message
      // may mention the other variables in guidance; the missing section/paragraph may
      // not.
      const enumeration = missingEnumeration(combined);
      expect(enumeration).toContain(ENV_VARS.POSTHOG_PROJECT_ID);

      const flaggedAsMissing = REQUIRED_ENV_VARS.filter((name) => enumeration.includes(name));
      expect(flaggedAsMissing).toEqual([ENV_VARS.POSTHOG_PROJECT_ID]);
    },
    SPAWN_TIMEOUT_MS,
  );
});
