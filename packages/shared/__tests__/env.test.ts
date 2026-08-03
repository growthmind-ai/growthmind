import { describe, expect, test } from "bun:test";

import type { ServerEnv } from "../src/env";
import { parseServerEnv } from "../src/env";
import { loadUnderConstruction } from "./onboarding/module-under-construction";

const PROD_COMPLETE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:secret@db.internal:5432/growthmind",
  BETTER_AUTH_SECRET: "a-real-secret-of-adequate-length",
  BETTER_AUTH_URL: "https://app.example.com",

  GROWTHMIND_ENCRYPTION_KEY: "cHJvZC1maXh0dXJlLWVuY3J5cHRpb24ta2V5LTMyYnk=",
};

const loadInterestPingConfigured = (): Promise<(env: ServerEnv) => boolean> =>
  loadUnderConstruction<(env: ServerEnv) => boolean>({
    modulePath: "../../src/env",
    exportName: "interestPingConfigured",
    ownedBy: "ADD Wave 1, the env task (AD-5, AD-9)",
  });

describe("parseServerEnv", () => {
  test("accepts a complete production environment", () => {
    const env = parseServerEnv(PROD_COMPLETE);
    expect(env.DATABASE_URL).toBe(PROD_COMPLETE.DATABASE_URL);
    expect(env.NODE_ENV).toBe("production");
  });

  test("production rejects the.env.example BETTER_AUTH_SECRET literal", () => {
    expect(() =>
      parseServerEnv({
        ...PROD_COMPLETE,
        BETTER_AUTH_SECRET: "dev-only-secret-change-me-32-chars!",
      }),
    ).toThrow(/still set to the public example value/);
  });

  test("production rejects the.env.example DATABASE_URL literal", () => {
    expect(() =>
      parseServerEnv({
        ...PROD_COMPLETE,
        DATABASE_URL: "postgres://growthmind:growthmind@localhost:5432/growthmind",
      }),
    ).toThrow(/still set to the public example value/);
  });

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

  // Stops somebody restoring `z.url().default("http://localhost:3000")`: a schema-level
  // default survives the production branch, and a deploy that omitted the variable booted
  // clean with sign-in links and the Slack redirect_uri both pointing at localhost.
  test("production has no fallbacks — a missing BETTER_AUTH_URL throws", () => {
    const { BETTER_AUTH_URL: _omitted, ...incomplete } = PROD_COMPLETE;
    expect(() => parseServerEnv(incomplete)).toThrow(/BETTER_AUTH_URL/);
  });

  // The other half: `cp .env.example .env` leaves the variable SET, so an absence-based
  // guard passes it through. `DEV_DEFAULTS` membership rejects it by value instead.
  test("production rejects the.env.example BETTER_AUTH_URL literal", () => {
    expect(() =>
      parseServerEnv({ ...PROD_COMPLETE, BETTER_AUTH_URL: "http://localhost:3000" }),
    ).toThrow(/still set to the public example value/);
  });

  // The quickstart compose stack sets both, so `docker compose up` still reaches an app.
  test("GROWTHMIND_ALLOW_INSECURE_DEFAULTS=1 permits the localhost BETTER_AUTH_URL in production", () => {
    const env = parseServerEnv({
      ...PROD_COMPLETE,
      BETTER_AUTH_URL: "http://localhost:3000",
      GROWTHMIND_ALLOW_INSECURE_DEFAULTS: "1",
    });
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
  });

  test("production rejects a short BETTER_AUTH_SECRET", () => {
    expect(() => parseServerEnv({ ...PROD_COMPLETE, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  test("development fills local defaults so a fresh clone runs with no.env", () => {
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

  // OPTIONAL IS THE DECISION, not a default nobody got round to tightening: these two rows
  // exist so a later "hardening" to required fails a NAMED test. Self-host is first-class,
  // so a clean clone with neither variable set must boot identically to one with both.
  const SLACK_ID = "1234567890.0987654321";
  const SLACK_SECRET = "fixture-client-secret-never-real";

  test("production boots with both, one, or neither Slack credential", () => {
    expect(PROD_COMPLETE).not.toHaveProperty("SLACK_CLIENT_ID");
    expect(PROD_COMPLETE).not.toHaveProperty("SLACK_CLIENT_SECRET");

    // ALL FOUR COMBINATIONS BOOT. Half a Slack app is `apps/web/lib/slack/oauth.ts`'s
    // problem — it declines to offer the path — never a reason to refuse to start.
    for (const [label, patch] of [
      ["neither", {}],
      ["only the id", { SLACK_CLIENT_ID: SLACK_ID }],
      ["only the secret", { SLACK_CLIENT_SECRET: SLACK_SECRET }],
      ["both", { SLACK_CLIENT_ID: SLACK_ID, SLACK_CLIENT_SECRET: SLACK_SECRET }],
    ] as const) {
      const env = parseServerEnv({ ...PROD_COMPLETE, ...patch });

      expect(`${label}:${env.NODE_ENV}`).toBe(`${label}:production`);
      expect(`${label}:${env.SLACK_CLIENT_ID ?? "absent"}`).toBe(
        `${label}:${"SLACK_CLIENT_ID" in patch ? SLACK_ID : "absent"}`,
      );
      expect(`${label}:${env.SLACK_CLIENT_SECRET ?? "absent"}`).toBe(
        `${label}:${"SLACK_CLIENT_SECRET" in patch ? SLACK_SECRET : "absent"}`,
      );
    }
  });

  // Why each variable is `z.string().min(1).optional()` and not a bare `.optional()`:
  // `SLACK_CLIENT_ID=` on its own line arrives as the EMPTY STRING, not as absent, and a
  // bare `.optional()` would read "configured" and redirect a founder into a consent
  // screen built with no client id. AN EMPTY CREDENTIAL MUST BE REJECTED, at boot, in
  // front of the operator who can fix it.
  test("an empty-string Slack credential is refused, never treated as configured", () => {
    for (const key of ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"] as const) {
      expect(() => parseServerEnv({ ...PROD_COMPLETE, [key]: "" })).toThrow(new RegExp(key));

      // THE CONTROL: a real value still boots, so the row above cannot pass by being
      // REQUIRED instead.
      expect(() => parseServerEnv({ ...PROD_COMPLETE, [key]: SLACK_ID })).not.toThrow();
    }
  });

  // W-7/W-8 (AD-5, AD-9): optional-by-construction like the Slack pair above, but a SET
  // value must be a URL — the operator set it deliberately, so a typo fails at boot.
  const INTEREST_WEBHOOK = "https://hooks.slack.com/services/T0000/B0000/fixture-token";

  test("production boots with the interest webhook absent or set, and the configured flag follows", async () => {
    const interestPingConfigured = await loadInterestPingConfigured();

    expect(PROD_COMPLETE).not.toHaveProperty("GROWTHMIND_INTEREST_SLACK_WEBHOOK");

    for (const [label, patch, configured] of [
      ["absent", {}, false],
      ["set", { GROWTHMIND_INTEREST_SLACK_WEBHOOK: INTEREST_WEBHOOK }, true],
    ] as const) {
      const env = parseServerEnv({ ...PROD_COMPLETE, ...patch });

      expect(`${label}:${env.NODE_ENV}`).toBe(`${label}:production`);
      expect(`${label}:${interestPingConfigured(env)}`).toBe(`${label}:${configured}`);
    }
  });

  test("a malformed interest webhook fails the parse at boot, never each send", () => {
    expect(() =>
      parseServerEnv({ ...PROD_COMPLETE, GROWTHMIND_INTEREST_SLACK_WEBHOOK: "not-a-webhook-url" }),
    ).toThrow(/GROWTHMIND_INTEREST_SLACK_WEBHOOK/);

    // THE CONTROL: the well-formed value still boots, so the row above cannot pass by the
    // variable being refused outright.
    expect(() =>
      parseServerEnv({ ...PROD_COMPLETE, GROWTHMIND_INTEREST_SLACK_WEBHOOK: INTEREST_WEBHOOK }),
    ).not.toThrow();
  });
});
