import { describe, expect, test } from "bun:test";
import type { z } from "zod";

import { webEnvSchema, workerEnvSchema } from "../src/env";

const COMPOSE = new URL("../../../docker-compose.yml", import.meta.url);
const WEB_DOCKERFILE = new URL("../../../apps/web/Dockerfile", import.meta.url);

// Each service boots one process, and each parses its OWN schema; a union let a web-only
// variable become a worker boot requirement.
const APP_SERVICES = [
  { name: "web", schema: webEnvSchema },
  { name: "worker", schema: workerEnvSchema },
] as const;

interface ComposeFile {
  readonly services: Record<string, { readonly environment?: Record<string, unknown> }>;
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
