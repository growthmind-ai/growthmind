import { describe, expect, test } from "bun:test";

import { loadValueUnderConstruction } from "./module-under-construction";

const OWNER = "ADD Wave 1, the onboarding/providers.ts task (AD-4)";
const MODULE = "../../src/onboarding/providers";

type ProviderDescriptor = {
  readonly id: string;
  readonly displayName: string;
  readonly rail: string;
  readonly live: boolean;
};

type InterestInputSchema = {
  safeParse(input: unknown): { readonly success: boolean };
};

const loadCatalogue = (): Promise<readonly ProviderDescriptor[]> =>
  loadValueUnderConstruction<readonly ProviderDescriptor[]>({
    modulePath: MODULE,
    exportName: "PROVIDER_CATALOGUE",
    ownedBy: OWNER,
  });

const loadInterestIds = (): Promise<readonly string[]> =>
  loadValueUnderConstruction<readonly string[]>({
    modulePath: MODULE,
    exportName: "INTEREST_PROVIDER_IDS",
    ownedBy: OWNER,
  });

const loadRails = (): Promise<readonly string[]> =>
  loadValueUnderConstruction<readonly string[]>({
    modulePath: MODULE,
    exportName: "PROVIDER_RAILS",
    ownedBy: OWNER,
  });

const loadInterestInputSchema = (): Promise<InterestInputSchema> =>
  loadValueUnderConstruction<InterestInputSchema>({
    modulePath: MODULE,
    exportName: "firstRunInterestInputSchema",
    ownedBy: OWNER,
  });

const SOON_IDS = [
  "github",
  "gitlab",
  "claude-code",
  "cursor",
  "copilot",
  "codex",
  "windsurf",
  "amplitude",
  "mixpanel",
  "growthmind-analytics",
] as const;

describe("the provider catalogue — AD-4, W-1, W-2", () => {
  test("INTEREST_PROVIDER_IDS set-equals the catalogue's non-live ids", async () => {
    const catalogue = await loadCatalogue();
    const interestIds = await loadInterestIds();

    const nonLive = catalogue.filter((entry) => !entry.live).map((entry) => entry.id);

    expect([...interestIds].toSorted()).toEqual([...nonLive].toSorted());
    expect(interestIds).toHaveLength(10);
    expect(new Set(interestIds).size).toBe(interestIds.length);
  });

  test("the catalogue names exactly one live provider, posthog, on the analytics rail", async () => {
    const catalogue = await loadCatalogue();

    expect(catalogue).toHaveLength(11);

    const live = catalogue.filter((entry) => entry.live);
    expect(live.map((entry) => entry.id)).toEqual(["posthog"]);
    expect(live[0]?.rail).toBe("analytics");
  });

  test("every descriptor carries a non-empty display name and a rail from PROVIDER_RAILS", async () => {
    const catalogue = await loadCatalogue();
    const rails = await loadRails();

    expect([...rails].toSorted()).toEqual(["analytics", "code", "coding-assistant"].toSorted());

    const unnamed = catalogue.filter((entry) => entry.displayName.trim().length === 0);
    expect(unnamed.map((entry) => entry.id)).toEqual([]);

    const offRail = catalogue.filter((entry) => !rails.includes(entry.rail));
    expect(offRail.map((entry) => `${entry.id} on ${entry.rail}`)).toEqual([]);

    const ids = catalogue.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the interest input schema — AD-4, W-3", () => {
  test("accepts each of the ten coming-soon provider ids", async () => {
    const schema = await loadInterestInputSchema();

    const refused = SOON_IDS.filter((provider) => !schema.safeParse({ provider }).success);
    expect(refused).toEqual([]);
  });

  test("refuses the live provider, an unknown provider, and the empty string", async () => {
    const schema = await loadInterestInputSchema();

    // The control: a sanctioned id passes, so the refusals below cannot pass by the
    // schema refusing everything.
    expect(schema.safeParse({ provider: "github" }).success).toBe(true);

    const accepted = ["posthog", "jira", ""].filter(
      (provider) => schema.safeParse({ provider }).success,
    );
    expect(accepted).toEqual([]);
  });

  test("refuses a body carrying an unknown extra key — the object is strict", async () => {
    const schema = await loadInterestInputSchema();

    expect(schema.safeParse({ provider: "github" }).success).toBe(true);
    expect(schema.safeParse({ provider: "github", extra: "x" }).success).toBe(false);
  });
});
