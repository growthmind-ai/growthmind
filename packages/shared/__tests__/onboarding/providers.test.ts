import { describe, expect, test } from "bun:test";

import { loadUnderConstruction, loadValueUnderConstruction } from "./module-under-construction";

const OWNER = "ADD Wave 1, the onboarding/providers.ts task (AD-4)";
const MODULE = "../../src/onboarding/providers";

const OWNER_O026 = "ADD O-026 D-8/D-10, the coding-assistant rail task";
const AGENT_BLOCKS_MODULE = "../../src/onboarding/agent-blocks";

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

const loadInterestIdSchema = (): Promise<InterestInputSchema> =>
  loadValueUnderConstruction<InterestInputSchema>({
    modulePath: MODULE,
    exportName: "interestProviderIdSchema",
    ownedBy: OWNER,
  });

const loadProviderDisplayName = (): Promise<(id: string) => string> =>
  loadUnderConstruction<(id: string) => string>({
    modulePath: MODULE,
    exportName: "providerDisplayName",
    ownedBy: OWNER_O026,
  });

const loadAgentProviderIds = (): Promise<readonly string[]> =>
  loadValueUnderConstruction<readonly string[]>({
    modulePath: AGENT_BLOCKS_MODULE,
    exportName: "AGENT_PROVIDER_IDS",
    ownedBy: OWNER_O026,
  });

// The five that stayed non-live after O-026 flipped the coding-assistant rail.
const SOON_IDS = ["github", "gitlab", "amplitude", "mixpanel", "growthmind-analytics"] as const;

const AGENT_IDS = ["claude-code", "cursor", "copilot", "codex", "windsurf"] as const;

describe("the provider catalogue — AD-4, W-1, W-2", () => {
  test("INTEREST_PROVIDER_IDS covers every non-live id and names nothing off the catalogue", async () => {
    const catalogue = await loadCatalogue();
    const interestIds = await loadInterestIds();

    const nonLive = catalogue.filter((entry) => !entry.live).map((entry) => entry.id);
    const uncollectable = nonLive.filter((id) => !interestIds.includes(id));
    expect(uncollectable).toEqual([]);

    const catalogueIds = new Set(catalogue.map((entry) => entry.id));
    const strangers = interestIds.filter((id) => !catalogueIds.has(id));
    expect(strangers).toEqual([]);

    expect(interestIds).toHaveLength(10);
    expect(new Set(interestIds).size).toBe(interestIds.length);

    // The five stay here after going live (O-026 D-8): persisted provider_interest
    // rows are typed by this enum, and narrowing it would make them unparseable.
    // The refusal they used to get from absence is asserted on the input schema below.
    const dropped = AGENT_IDS.filter((id) => !interestIds.includes(id));
    expect(dropped).toEqual([]);
  });

  test("the analytics rail names exactly one live provider, posthog", async () => {
    const catalogue = await loadCatalogue();

    expect(catalogue).toHaveLength(11);

    const analytics = catalogue.filter((entry) => entry.rail === "analytics");
    expect(analytics.filter((entry) => entry.live).map((entry) => entry.id)).toEqual(["posthog"]);

    const liveCode = catalogue.filter((entry) => entry.rail === "code" && entry.live);
    expect(liveCode.map((entry) => entry.id)).toEqual([]);
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
  test("accepts each of the coming-soon provider ids", async () => {
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

describe("the coding-assistant rail goes live — O-026 D-8, D-10", () => {
  test("AGENT_PROVIDER_IDS lists exactly the coding-assistant ids the catalogue declares", async () => {
    const catalogue = await loadCatalogue();
    const agentIds = await loadAgentProviderIds();

    const fromCatalogue = catalogue
      .filter((entry) => entry.rail === "coding-assistant")
      .map((entry) => entry.id);

    expect([...agentIds]).toEqual(fromCatalogue);
    expect(agentIds).toHaveLength(5);
    expect(new Set(agentIds).size).toBe(agentIds.length);
  });

  test("all five coding assistants are live", async () => {
    const catalogue = await loadCatalogue();

    const rail = catalogue.filter((entry) => entry.rail === "coding-assistant");
    expect(rail.map((entry) => entry.id)).toEqual([...AGENT_IDS]);

    const notLive = rail.filter((entry) => !entry.live).map((entry) => entry.id);
    expect(notLive).toEqual([]);
  });

  test("every provider id resolves to a display name that is not the id", async () => {
    const catalogue = await loadCatalogue();
    const interestIds = await loadInterestIds();
    const providerDisplayName = await loadProviderDisplayName();

    const declared = new Map(catalogue.map((entry) => [entry.id, entry.displayName]));

    // Every member of the ProviderId union, so the `?? id` fallback is unreachable.
    const offenders: string[] = [];
    for (const id of [...interestIds, "posthog"]) {
      const name = providerDisplayName(id);
      if (name.trim().length === 0) offenders.push(`${id} resolves to nothing`);
      if (name === id) offenders.push(`${id} falls back to its own id`);
      if (name !== declared.get(id)) offenders.push(`${id} disagrees with the catalogue`);
    }

    expect(offenders).toEqual([]);
  });

  test("the interest input refuses a now-live assistant while the id schema still parses one", async () => {
    const inputSchema = await loadInterestInputSchema();
    const idSchema = await loadInterestIdSchema();

    const accepted = AGENT_IDS.filter((provider) => inputSchema.safeParse({ provider }).success);
    expect(accepted).toEqual([]);

    // The other half, and the load-bearing one: `interestProviderIdSchema` types
    // already-persisted rows. A refinement here would make stored rows unparseable
    // and silently starve the read that orders the panel.
    const unparseable = AGENT_IDS.filter((provider) => !idSchema.safeParse(provider).success);
    expect(unparseable).toEqual([]);

    // The controls: a still-soon provider passes both, and posthog is still refused.
    expect(inputSchema.safeParse({ provider: "github" }).success).toBe(true);
    expect(idSchema.safeParse("github").success).toBe(true);
    expect(inputSchema.safeParse({ provider: "posthog" }).success).toBe(false);
  });
});
