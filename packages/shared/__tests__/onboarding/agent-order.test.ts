import { describe, expect, test } from "bun:test";

import { loadUnderConstruction } from "./module-under-construction";

const OWNER = "ADD O-026 Wave 1, the onboarding/providers.ts task (D-6, FR-18)";
const MODULE = "../../src/onboarding/providers";

type AgentProviderOrder = (noted: readonly string[]) => readonly string[];

const CATALOGUE_ORDER = ["claude-code", "cursor", "copilot", "codex", "windsurf"] as const;

const loadAgentProviderOrder = (): Promise<AgentProviderOrder> =>
  loadUnderConstruction<AgentProviderOrder>({
    modulePath: MODULE,
    exportName: "agentProviderOrder",
    ownedBy: OWNER,
  });

describe("agentProviderOrder — deterministic, total, fail-open (FR-18)", () => {
  test("should order all five providers in catalogue order when nothing is noted", async () => {
    const agentProviderOrder = await loadAgentProviderOrder();

    expect(agentProviderOrder([])).toEqual([...CATALOGUE_ORDER]);
  });

  test("should lead with both noted providers in catalogue order relative to each other", async () => {
    const agentProviderOrder = await loadAgentProviderOrder();

    const ordered = agentProviderOrder(["windsurf", "cursor"]);
    const at = (id: string): number => ordered.indexOf(id);

    expect(ordered).toHaveLength(5);
    expect(at("cursor")).toBeLessThan(at("windsurf"));

    const trailing = ["claude-code", "copilot", "codex"].map(at);
    expect(trailing.every((position) => position > at("windsurf"))).toBe(true);

    expect(ordered).toEqual(["cursor", "windsurf", "claude-code", "copilot", "codex"]);
  });

  test("should ignore an unrecognised noted id and still return all five", async () => {
    const agentProviderOrder = await loadAgentProviderOrder();

    const inputs: readonly (readonly string[])[] = [
      ["not-an-assistant"],
      ["mixpanel"],
      ["mixpanel", "not-an-assistant", "codex"],
    ];

    for (const noted of inputs) {
      expect(() => agentProviderOrder(noted)).not.toThrow();

      const ordered = agentProviderOrder(noted);
      expect(ordered).toHaveLength(5);
      expect([...ordered].toSorted()).toEqual([...CATALOGUE_ORDER].toSorted());
    }

    expect(agentProviderOrder(["mixpanel", "not-an-assistant", "codex"])[0]).toBe("codex");
  });

  test("should produce the same order for the same input on every call", async () => {
    const agentProviderOrder = await loadAgentProviderOrder();

    const inputs: readonly (readonly string[])[] = [
      [],
      ["windsurf", "cursor"],
      ["copilot"],
      ["not-an-assistant"],
    ];

    for (const noted of inputs) {
      expect(agentProviderOrder(noted)).toEqual(agentProviderOrder(noted));
    }
  });
});
