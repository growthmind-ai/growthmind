import { describe, expect, test } from "bun:test";

import { parseWebEnv, type WebEnv } from "@growthmind/shared";

import { fixtureAt, offenders, webSources } from "../first-run/helpers/first-run-source";
import {
  authProviderLabel,
  configuredSocialProviders,
  resolveSocialCredentials,
  socialProvidersConfig,
  SOCIAL_PROVIDERS,
} from "../../lib/social-auth";

const PROD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:secret@db.internal:5432/growthmind",
  BETTER_AUTH_SECRET: "a-real-secret-of-adequate-length",
  BETTER_AUTH_URL: "https://app.example.com",
  GROWTHMIND_ENCRYPTION_KEY: "cHJvZC1maXh0dXJlLWVuY3J5cHRpb24ta2V5LTMyYnk=",
};

const env = (patch: Record<string, string> = {}): WebEnv => parseWebEnv({ ...PROD, ...patch });

const GOOGLE = { GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "google-secret" };
const GITHUB = { GITHUB_CLIENT_ID: "github-id", GITHUB_CLIENT_SECRET: "github-secret" };

describe("social provider credentials are both-or-neither", () => {
  // Half a credential pair is the worst of the three states: the button renders, the person
  // reaches the provider's consent screen, approves, and the exchange dies after they have
  // already left the product.
  test("each provider resolves only when both halves are present", () => {
    for (const [label, patch, google, github] of [
      ["neither", {}, false, false],
      ["google only id", { GOOGLE_CLIENT_ID: "google-id" }, false, false],
      ["google only secret", { GOOGLE_CLIENT_SECRET: "google-secret" }, false, false],
      ["google both", GOOGLE, true, false],
      ["github only id", { GITHUB_CLIENT_ID: "github-id" }, false, false],
      ["github both", GITHUB, false, true],
      ["both providers", { ...GOOGLE, ...GITHUB }, true, true],
    ] as const) {
      const resolved = env(patch);

      expect(`${label}:google:${resolveSocialCredentials(resolved, "google") !== null}`).toBe(
        `${label}:google:${google}`,
      );
      expect(`${label}:github:${resolveSocialCredentials(resolved, "github") !== null}`).toBe(
        `${label}:github:${github}`,
      );
    }
  });

  // The screen reads the raw source rather than the parsed web schema, so the empty-string
  // rejection the schema performs at boot has to be performed here too. `KEY=` on its own
  // line is the empty string, not absence.
  test("an empty or whitespace credential is absent, never configured", () => {
    for (const value of ["", "   ", "\t"]) {
      expect(
        resolveSocialCredentials(
          { GOOGLE_CLIENT_ID: value, GOOGLE_CLIENT_SECRET: "google-secret" },
          "google",
        ),
      ).toBeNull();
    }

    // THE CONTROL: a real value through the same raw-source path still resolves.
    expect(configuredSocialProviders({ ...GOOGLE, ...GITHUB })).toEqual(SOCIAL_PROVIDERS);
  });

  test("a resolved provider carries the id and secret it was configured with", () => {
    expect(resolveSocialCredentials(env(GOOGLE), "google")).toEqual({
      clientId: "google-id",
      clientSecret: "google-secret",
    });
  });

  test("configuredSocialProviders lists only the whole pairs, in a stable order", () => {
    expect(configuredSocialProviders(env())).toEqual([]);
    expect(configuredSocialProviders(env(GOOGLE))).toEqual(["google"]);
    expect(configuredSocialProviders(env(GITHUB))).toEqual(["github"]);
    expect(configuredSocialProviders(env({ ...GOOGLE, ...GITHUB }))).toEqual(SOCIAL_PROVIDERS);
  });

  // What Better Auth is handed. An empty object is the supported state, not a degraded one:
  // email and password stays enabled, so a clean clone is a whole product.
  test("socialProvidersConfig omits a provider entirely rather than passing a half pair", () => {
    expect(socialProvidersConfig(env())).toEqual({});
    expect(socialProvidersConfig(env({ GOOGLE_CLIENT_ID: "google-id" }))).toEqual({});
    expect(socialProvidersConfig(env(GOOGLE))).toEqual({
      google: { clientId: "google-id", clientSecret: "google-secret" },
    });
  });
});

describe("authProviderLabel names the provider or admits it does not know", () => {
  // The bug this replaces: "email" was hardcoded, so every social sign-up was reported as
  // an email one and the signup mix was unreadable.
  test("maps Better Auth's stored provider id to the reported label", () => {
    for (const [providerId, label] of [
      ["credential", "email"],
      ["google", "google"],
      ["github", "github"],
    ] as const) {
      expect(`${providerId}:${authProviderLabel(providerId)}`).toBe(`${providerId}:${label}`);
    }
  });

  test("an absent or unrecognised provider is unknown, never guessed as email", () => {
    expect(authProviderLabel(null)).toBe("unknown");
    expect(authProviderLabel("apple")).toBe("unknown");
    expect(authProviderLabel("")).toBe("unknown");
  });
});

const PLANTED_PUBLIC_SOCIAL = fixtureAt(
  "apps/web/lib/planted-social.ts",
  `export const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";\n`,
);

const publishedSocialCredentials = (files: Parameters<typeof offenders>[0]): readonly string[] =>
  offenders(files, /\bNEXT_PUBLIC_(?:GOOGLE|GITHUB)[A-Z0-9_]*/);

describe("no social credential reaches the browser bundle", () => {
  test("the scan catches a planted NEXT_PUBLIC_ twin and finds none in the real sources", () => {
    expect(publishedSocialCredentials([PLANTED_PUBLIC_SOCIAL])).not.toEqual([]);
    expect(publishedSocialCredentials(webSources())).toEqual([]);
  });
});
