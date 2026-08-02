import { describe, expect, test } from "bun:test";

import { serverEnvSchema } from "../src/env";

const COMPOSE = new URL("../../../docker-compose.yml", import.meta.url);

// The two services that boot the app and therefore run `parseServerEnv`.
// Postgres is the datastore and parses nothing.
const APP_SERVICES = ["web", "worker"] as const;

interface ComposeFile {
  readonly services: Record<string, { readonly environment?: Record<string, unknown> }>;
}

async function compose(): Promise<ComposeFile> {
  return Bun.YAML.parse(await Bun.file(COMPOSE).text()) as ComposeFile;
}

function requiredKeys(): readonly string[] {
  return Object.entries(serverEnvSchema.shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
}

describe("the compose stack boots on the environment the schema demands", () => {
  test("the schema has required keys to check", () => {
    expect(requiredKeys().length).toBeGreaterThan(0);
    expect(requiredKeys()).toContain("BETTER_AUTH_URL");
  });

  test("every app service forwards every required variable", async () => {
    const { services } = await compose();
    const required = requiredKeys();

    const missing: string[] = [];
    for (const name of APP_SERVICES) {
      const declared = new Set(Object.keys(services[name]?.environment ?? {}));
      for (const key of required) {
        if (!declared.has(key)) missing.push(`${name}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("no app service forwards a required variable as an empty value", async () => {
    const { services } = await compose();
    const required = new Set(requiredKeys());

    const valueless: string[] = [];
    for (const name of APP_SERVICES) {
      for (const [key, value] of Object.entries(services[name]?.environment ?? {})) {
        // Compose's pass-through form (`KEY:` with nothing after it) parses to
        // null and leaves the variable unset — fine for an optional, fatal for
        // a required one.
        if (required.has(key) && (value === null || value === ""))
          valueless.push(`${name}: ${key}`);
      }
    }

    expect(valueless).toEqual([]);
  });
});
