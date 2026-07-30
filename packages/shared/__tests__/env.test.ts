import { describe, expect, test } from "bun:test";

import { parseServerEnv } from "../src/env";

const PROD_COMPLETE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:secret@db.internal:5432/growthmind",
  BETTER_AUTH_SECRET: "a-real-secret-of-adequate-length",
  BETTER_AUTH_URL: "https://app.example.com",
};

describe("parseServerEnv", () => {
  test("accepts a complete production environment", () => {
    const env = parseServerEnv(PROD_COMPLETE);
    expect(env.DATABASE_URL).toBe(PROD_COMPLETE.DATABASE_URL);
    expect(env.NODE_ENV).toBe("production");
  });

  test("production has no fallbacks — a missing DATABASE_URL throws", () => {
    const { DATABASE_URL: _omitted, ...incomplete } = PROD_COMPLETE;
    expect(() => parseServerEnv(incomplete)).toThrow(/DATABASE_URL/);
  });

  test("production rejects a short BETTER_AUTH_SECRET", () => {
    expect(() => parseServerEnv({ ...PROD_COMPLETE, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  test("development fills local defaults so a fresh clone runs with no .env", () => {
    const env = parseServerEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toContain("localhost:5432/growthmind");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
  });

  test("development still prefers an explicitly set value over the default", () => {
    const env = parseServerEnv({ DATABASE_URL: "postgres://me:pw@localhost:5433/custom" });
    expect(env.DATABASE_URL).toBe("postgres://me:pw@localhost:5433/custom");
  });

  test("a key explicitly set to undefined does not shadow the dev default", () => {
    const env = parseServerEnv({ DATABASE_URL: undefined });
    expect(env.DATABASE_URL).toContain("localhost:5432/growthmind");
  });

  test("ANTHROPIC_API_KEY is optional everywhere", () => {
    const env = parseServerEnv(PROD_COMPLETE);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
