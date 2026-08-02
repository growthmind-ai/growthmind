import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { ENV_VARS, REQUIRED_ENV_VARS } from "../lib/constants";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

const ENTRYPOINT = join("scripts", "spikes", "m0-posthog-latency.ts");

const LOCAL_SPIKES_DIR = join(REPO_ROOT, "local", "spikes");

const NO_VARS_ENV_FILE = join(import.meta.dir, "fixtures", "no-vars.env");

const SPAWN_TIMEOUT_MS = 60_000;

function scrubbedEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith("POSTHOG_")) delete env[key];
  }
  return env;
}

function listLocalSpikes(): string[] {
  try {
    return readdirSync(LOCAL_SPIKES_DIR).toSorted();
  } catch {
    return [];
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

      expect(exitCode).not.toBe(0);

      for (const name of REQUIRED_ENV_VARS) {
        expect(combined).toContain(name);
      }

      expect(combined).not.toMatch(/\n\s+at /);

      expect(listLocalSpikes()).toEqual(before);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "entrypoint names exactly the one missing variable when three are set to dummies",
    async () => {
      const env = scrubbedEnv();
      env[ENV_VARS.POSTHOG_HOST] = "https://dummy.example";
      env[ENV_VARS.POSTHOG_PROJECT_API_KEY] = "phc_dummy";
      env[ENV_VARS.POSTHOG_PERSONAL_API_KEY] = "phx_dummy";

      const { exitCode, combined } = await runEntrypoint(env);

      expect(exitCode).not.toBe(0);

      const enumeration = missingEnumeration(combined);
      expect(enumeration).toContain(ENV_VARS.POSTHOG_PROJECT_ID);

      const flaggedAsMissing = REQUIRED_ENV_VARS.filter((name) => enumeration.includes(name));
      expect(flaggedAsMissing).toEqual([ENV_VARS.POSTHOG_PROJECT_ID]);
    },
    SPAWN_TIMEOUT_MS,
  );
});
