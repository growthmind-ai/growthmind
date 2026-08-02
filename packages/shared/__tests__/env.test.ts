import { describe, expect, test } from "bun:test";

import { parseServerEnv } from "../src/env";

const PROD_COMPLETE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:secret@db.internal:5432/growthmind",
  BETTER_AUTH_SECRET: "a-real-secret-of-adequate-length",
  BETTER_AUTH_URL: "https://app.example.com",

  GROWTHMIND_ENCRYPTION_KEY: "cHJvZC1maXh0dXJlLWVuY3J5cHRpb24ta2V5LTMyYnk=",
};

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

  /**
   * THE ROW THAT STOPS SOMEBODY RESTORING `z.url().default("http://localhost:3000")`.
   *
   * A schema-level default survives the production branch below, which withholds
   * `DEV_DEFAULTS` and nothing else — so BETTER_AUTH_URL was this file's own
   * docstring's counterexample: "in production there are no fallbacks" was true
   * of every variable except the one that decides where sign-in links point and
   * where Slack is told to deliver authorization codes
   * (`apps/web/lib/slack/oauth.ts`, `slackOAuthRedirectUri`). A production deploy
   * that omitted it booted clean and pointed both at localhost.
   *
   * The fix is a `DEV_DEFAULTS` entry rather than a field default, and this row
   * is what makes moving it back a red test rather than a silent regression.
   */
  test("production has no fallbacks — a missing BETTER_AUTH_URL throws", () => {
    const { BETTER_AUTH_URL: _omitted, ...incomplete } = PROD_COMPLETE;
    expect(() => parseServerEnv(incomplete)).toThrow(/BETTER_AUTH_URL/);
  });

  /**
   * The other half, and the reason the `DEV_DEFAULTS` entry is the right home
   * rather than a bare `required` in the schema.
   *
   * The documented setup is `cp.env.example.env`, and.env.example necessarily
   * ships `BETTER_AUTH_URL=http://localhost:3000` so local dev works. Copy it,
   * run the production profile, and the variable IS set — absence-based guards
   * pass it straight through to a deployment whose Slack `redirect_uri` is on
   * localhost. Membership of `DEV_DEFAULTS` puts it in the by-value rejection
   * loop, the same as the secret and the encryption key.
   */
  test("production rejects the.env.example BETTER_AUTH_URL literal", () => {
    expect(() =>
      parseServerEnv({ ...PROD_COMPLETE, BETTER_AUTH_URL: "http://localhost:3000" }),
    ).toThrow(/still set to the public example value/);
  });

  // The quickstart compose stack sets BETTER_AUTH_URL to localhost AND sets the
  // bypass flag (docker-compose.yml), so `docker compose up` from a clean clone
  // must still reach a working app. CI boots that stack on every push.
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

  // The Slack app's OAuth credentials, on exactly the terms `ANTHROPIC_API_KEY`
  // and the four POSTHOG_* variables are already held to.
  //
  // OPTIONAL IS THE DECISION, NOT A DEFAULT NOBODY GOT ROUND TO TIGHTENING —
  // and the whole point of these two rows is that the decision now fails a
  // NAMED test if somebody later "hardens" it to required. Self-host is
  // first-class (AGENTS.md, Conventions): a clean clone with neither variable
  // set must sign up, boot and pass the full gate identically to one that has
  // both. Absent, the Add-to-Slack control does not render and the pasted-token
  // form is the primary path. Never a boot failure.
  //
  // Fixture-shaped and obviously invalid — this repository is public and no
  // fixture in it will ever carry usable credential material.
  const SLACK_ID = "1234567890.0987654321";
  const SLACK_SECRET = "fixture-client-secret-never-real";

  test("production boots with both, one, or neither Slack credential", () => {
    // The baseline carries neither, so "both absent" below is a statement about
    // the schema rather than about this fixture happening to omit them.
    expect(PROD_COMPLETE).not.toHaveProperty("SLACK_CLIENT_ID");
    expect(PROD_COMPLETE).not.toHaveProperty("SLACK_CLIENT_SECRET");

    // ALL FOUR COMBINATIONS BOOT. "One alone" is the interesting pair: an id
    // with no secret reaches Slack's consent screen and dies at the exchange,
    // which is the worst of the three states — but it is `apps/web/lib/slack/
    // oauth.ts` that reads the pair together and declines to offer the path,
    // NOT this schema refusing to start the process. A deployment that cannot
    // boot because half a Slack app is configured is a deployment whose
    // findings stop for a reason that has nothing to do with findings.
    for (const [label, patch] of [
      ["neither", {}],
      ["only the id", { SLACK_CLIENT_ID: SLACK_ID }],
      ["only the secret", { SLACK_CLIENT_SECRET: SLACK_SECRET }],
      ["both", { SLACK_CLIENT_ID: SLACK_ID, SLACK_CLIENT_SECRET: SLACK_SECRET }],
    ] as const) {
      const env = parseServerEnv({ ...PROD_COMPLETE, ...patch });

      // Labelled, so a failure names WHICH combination refused to boot rather
      // than reporting a bare `expected "production", received undefined` from
      // whichever iteration threw.
      expect(`${label}:${env.NODE_ENV}`).toBe(`${label}:production`);
      expect(`${label}:${env.SLACK_CLIENT_ID ?? "absent"}`).toBe(
        `${label}:${"SLACK_CLIENT_ID" in patch ? SLACK_ID : "absent"}`,
      );
      expect(`${label}:${env.SLACK_CLIENT_SECRET ?? "absent"}`).toBe(
        `${label}:${"SLACK_CLIENT_SECRET" in patch ? SLACK_SECRET : "absent"}`,
      );
    }
  });

  // The half-filled.env shape, and the reason each variable is
  // `z.string().min(1).optional()` rather than a bare `.optional()`.
  //
  // `SLACK_CLIENT_ID=` on its own line is what a partially-filled.env actually
  // looks like, and it arrives as the EMPTY STRING, not as absent. A bare
  // `.optional()` would accept it, `resolveSlackOAuthCredentials` would read
  // "both present", and the founder would be redirected into a consent screen
  // built with no client id — a dead end wearing a working feature's clothes,
  // outside the product, on Slack's error page for an app that does not exist.
  // Refusing at boot puts the fault in front of the operator who can fix it.
  test("an empty-string Slack credential is refused, never treated as configured", () => {
    for (const key of ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"] as const) {
      expect(() => parseServerEnv({ ...PROD_COMPLETE, [key]: "" })).toThrow(new RegExp(key));

      // THE CONTROL: the same key carrying a real value boots. Without it the
      // assertion above would pass against a schema that had made the variable
      // REQUIRED — the opposite defect, and the one the row before this exists
      // to rule out — or against a `PROD_COMPLETE` that had stopped parsing for
      // some reason of its own.
      expect(() => parseServerEnv({ ...PROD_COMPLETE, [key]: SLACK_ID })).not.toThrow();
    }
  });
});
