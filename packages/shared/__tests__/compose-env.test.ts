import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import type { z } from "zod";

import { webEnvSchema, workerEnvSchema } from "../src/env";

const COMPOSE = new URL("../../../docker-compose.yml", import.meta.url);
const WEB_DOCKERFILE = new URL("../../../apps/web/Dockerfile", import.meta.url);
const WEB_SOURCE = path.join(path.dirname(fileURLToPath(COMPOSE)), "apps", "web");

// Each service boots one process, and each parses its OWN schema; a union let a web-only
// variable become a worker boot requirement.
const APP_SERVICES = [
  { name: "web", schema: webEnvSchema },
  { name: "worker", schema: workerEnvSchema },
] as const;

interface ComposeFile {
  readonly services: Record<
    string,
    {
      readonly environment?: Record<string, unknown>;
      readonly build?: { readonly args?: Record<string, unknown> };
    }
  >;
}

const PUBLIC_ENV_READ = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g;
const SKIPPED_DIRS = new Set(["node_modules", ".next", "__tests__"]);

function publicVariablesReadByWeb(): readonly string[] {
  const found = new Set<string>();

  for (const entry of readdirSync(WEB_SOURCE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name);
    if (full.split(path.sep).some((segment) => SKIPPED_DIRS.has(segment))) continue;

    for (const [, name] of readFileSync(full, "utf-8").matchAll(PUBLIC_ENV_READ)) found.add(name);
  }

  return [...found].toSorted();
}

async function compose(): Promise<ComposeFile> {
  return Bun.YAML.parse(await Bun.file(COMPOSE).text()) as ComposeFile;
}

function requiredKeys(schema: z.ZodObject<z.ZodRawShape>): readonly string[] {
  return Object.entries(schema.shape)
    .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
    .map(([key]) => key);
}

describe("the compose stack boots on the environment each schema demands", () => {
  test("each process has required keys to check", () => {
    for (const { name, schema } of APP_SERVICES) {
      expect(`${name}:${requiredKeys(schema).length > 0}`).toBe(`${name}:true`);
    }
  });

  test("every app service forwards every variable its own process requires", async () => {
    const { services } = await compose();

    const missing: string[] = [];
    for (const { name, schema } of APP_SERVICES) {
      const declared = new Set(Object.keys(services[name]?.environment ?? {}));
      for (const key of requiredKeys(schema)) {
        if (!declared.has(key)) missing.push(`${name}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("no app service forwards a required variable as an empty value", async () => {
    const { services } = await compose();

    const valueless: string[] = [];
    for (const { name, schema } of APP_SERVICES) {
      const required = new Set(requiredKeys(schema));
      for (const [key, value] of Object.entries(services[name]?.environment ?? {})) {
        // `KEY:` with nothing after it parses to null and leaves it unset — fine for an
        // optional, fatal for a required one.
        if (required.has(key) && (value === null || value === ""))
          valueless.push(`${name}: ${key}`);
      }
    }

    expect(valueless).toEqual([]);
  });

  // The outage: requiring web-only `BETTER_AUTH_URL` of the worker crash-looped it.
  test("the worker is not required to supply any web-only variable", () => {
    const webOnly = Object.keys(webEnvSchema.shape).filter(
      (key) => !(key in workerEnvSchema.shape),
    );

    expect(webOnly).toContain("BETTER_AUTH_URL");
    expect(webOnly).toContain("BETTER_AUTH_SECRET");
    expect(requiredKeys(workerEnvSchema).filter((key) => webOnly.includes(key))).toEqual([]);
  });
});

// A deploy target's start command REPLACES the image CMD, so the migrate half is
// droppable without touching this repo. This guards the repo half only.
describe("the web image migrates before it serves", () => {
  test("the Dockerfile CMD still runs migrations ahead of the server", async () => {
    const dockerfile = await Bun.file(WEB_DOCKERFILE).text();
    const cmd = dockerfile.split("\n").find((line) => line.startsWith("CMD"));

    expect(cmd).toBeDefined();
    expect(cmd).toContain("db:migrate");
    expect(cmd?.indexOf("db:migrate")).toBeLessThan(cmd?.indexOf("web start") ?? -1);
  });
});

// B-043: Next.js inlines NEXT_PUBLIC_* when it compiles, so a value supplied to the
// running container arrives after the only moment it could have been read. The web
// image built without them for every deploy, and posthog.init() never ran.
describe("the web image is built with the variables the browser bundle inlines", () => {
  test("the scan sees the real reads", () => {
    expect(publicVariablesReadByWeb()).toContain("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN");
  });

  test("the Dockerfile declares an ARG for every one, ahead of the build", async () => {
    const dockerfile = await Bun.file(WEB_DOCKERFILE).text();
    const buildAt = dockerfile.indexOf("RUN bun run --filter @growthmind/web build");

    const missing = publicVariablesReadByWeb().filter((name) => {
      const declared = dockerfile.indexOf(`ARG ${name}`);
      return declared === -1 || declared > buildAt;
    });

    expect(
      missing,
      `apps/web/Dockerfile must declare (and ENV through) an ARG for: ${missing.join(", ")}. ` +
        `Without it the value is undefined when Next.js compiles, and setting it on the ` +
        `deploy target changes nothing until a rebuild that receives it.`,
    ).toEqual([]);
  });

  test("compose forwards every one as a build arg, not only as runtime environment", async () => {
    const { services } = await compose();
    const args = new Set(Object.keys(services.web?.build?.args ?? {}));

    expect(publicVariablesReadByWeb().filter((name) => !args.has(name))).toEqual([]);
  });

  test("an unset variable still builds — analytics off is the self-host default", async () => {
    const dockerfile = await Bun.file(WEB_DOCKERFILE).text();

    for (const name of publicVariablesReadByWeb()) {
      expect(`${name}:${new RegExp(`ARG ${name}=`).test(dockerfile)}`).toBe(`${name}:false`);
    }
  });
});
