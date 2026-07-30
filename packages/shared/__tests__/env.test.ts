import { describe, expect, test } from "bun:test";

import { parseServerEnv } from "../src/env";

const PROD_COMPLETE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:secret@db.internal:5432/growthmind",
  BETTER_AUTH_SECRET: "a-real-secret-of-adequate-length",
  BETTER_AUTH_URL: "https://app.example.com",
  // O-003 D-1: GROWTHMIND_ENCRYPTION_KEY is required, so a "complete
  // production environment" fixture now has to carry one. Deliberately NOT
  // the published dev literal — that value has its own rejection tests.
  GROWTHMIND_ENCRYPTION_KEY: "cHJvZC1maXh0dXJlLWVuY3J5cHRpb24ta2V5LTMyYnk=",
};

describe("parseServerEnv", () => {
  test("accepts a complete production environment", () => {
    const env = parseServerEnv(PROD_COMPLETE);
    expect(env.DATABASE_URL).toBe(PROD_COMPLETE.DATABASE_URL);
    expect(env.NODE_ENV).toBe("production");
  });

  // The `cp .env.example .env` path: the variable IS set, and is schema-valid
  // (34 chars), so absence-based guards pass it straight through — while the
  // app signs every session cookie with a secret published in a public repo.
  test("production rejects the .env.example BETTER_AUTH_SECRET literal", () => {
    expect(() =>
      parseServerEnv({
        ...PROD_COMPLETE,
        BETTER_AUTH_SECRET: "dev-only-secret-change-me-32-chars!",
      }),
    ).toThrow(/still set to the public example value/);
  });

  test("production rejects the .env.example DATABASE_URL literal", () => {
    expect(() =>
      parseServerEnv({
        ...PROD_COMPLETE,
        DATABASE_URL: "postgres://growthmind:growthmind@localhost:5432/growthmind",
      }),
    ).toThrow(/still set to the public example value/);
  });

  // The quickstart compose stack sets this so `docker compose up` from a clean
  // clone still boots (CI enforces that promise). Deleting the line from a real
  // deployment re-arms the guard above.
  test("GROWTHMIND_ALLOW_INSECURE_DEFAULTS=1 permits the example values in production", () => {
    const env = parseServerEnv({
      ...PROD_COMPLETE,
      BETTER_AUTH_SECRET: "dev-only-secret-change-me-32-chars!",
      GROWTHMIND_ALLOW_INSECURE_DEFAULTS: "1",
    });
    expect(env.BETTER_AUTH_SECRET).toBe("dev-only-secret-change-me-32-chars!");
  });

  test('any value other than exactly "1" does not bypass the guard', () => {
    expect(() =>
      parseServerEnv({
        ...PROD_COMPLETE,
        BETTER_AUTH_SECRET: "dev-only-secret-change-me-32-chars!",
        GROWTHMIND_ALLOW_INSECURE_DEFAULTS: "true",
      }),
    ).toThrow(/still set to the public example value/);
  });

  test("development still accepts the example values", () => {
    const env = parseServerEnv({ NODE_ENV: "development" });
    expect(env.BETTER_AUTH_SECRET).toBe("dev-only-secret-change-me-32-chars!");
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

  // ADD §9 item 7 — FR-17 / OQ-4 graceful absence (O-003 D-14).
  //
  // The four POSTHOG_* variables are validated-if-present and read by nothing
  // in the app: customer credentials come exclusively from project_connections,
  // because a global env key would be a single-tenant design in a multi-tenant
  // product. So a self-hoster who has no PostHog account at all must boot a
  // PRODUCTION deployment cleanly, with none of them set.
  test("parses in production with all four POSTHOG_* absent", () => {
    for (const key of [
      "POSTHOG_HOST",
      "POSTHOG_PROJECT_API_KEY",
      "POSTHOG_PERSONAL_API_KEY",
      "POSTHOG_PROJECT_ID",
    ]) {
      expect(PROD_COMPLETE).not.toHaveProperty(key);
    }

    const env = parseServerEnv(PROD_COMPLETE);

    expect(env.NODE_ENV).toBe("production");
    expect(env.POSTHOG_HOST).toBeUndefined();
    expect(env.POSTHOG_PROJECT_API_KEY).toBeUndefined();
    expect(env.POSTHOG_PERSONAL_API_KEY).toBeUndefined();
    expect(env.POSTHOG_PROJECT_ID).toBeUndefined();
  });
});
