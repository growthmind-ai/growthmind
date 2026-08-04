import { describe, expect, test } from "bun:test";

import { loadUnderConstruction } from "./module-under-construction";

const OWNER = "ADD O-026 Wave 1, the onboarding/agent.ts task (D-6)";
const MODULE = "../../src/onboarding/agent";

type ApiKeyUseSummary = {
  readonly liveCount: number;
  readonly anyUsed: boolean;
};

type AgentConnection =
  { readonly kind: "none" } | { readonly kind: "waiting" } | { readonly kind: "connected" };

type ToAgentConnection = (use: ApiKeyUseSummary) => AgentConnection;

const loadToAgentConnection = (): Promise<ToAgentConnection> =>
  loadUnderConstruction<ToAgentConnection>({
    modulePath: MODULE,
    exportName: "toAgentConnection",
    ownedBy: OWNER,
  });

describe("toAgentConnection — the closed discriminated union (D-6)", () => {
  test("should return connected when any live key carries a stamp", async () => {
    const toAgentConnection = await loadToAgentConnection();

    expect(toAgentConnection({ liveCount: 2, anyUsed: true })).toEqual({ kind: "connected" });
    expect(toAgentConnection({ liveCount: 1, anyUsed: true })).toEqual({ kind: "connected" });
  });

  test("should return waiting when live keys exist and no stamp does", async () => {
    const toAgentConnection = await loadToAgentConnection();

    expect(toAgentConnection({ liveCount: 1, anyUsed: false })).toEqual({ kind: "waiting" });
    expect(toAgentConnection({ liveCount: 3, anyUsed: false })).toEqual({ kind: "waiting" });
  });

  test("should return none when zero live keys exist", async () => {
    const toAgentConnection = await loadToAgentConnection();

    expect(toAgentConnection({ liveCount: 0, anyUsed: false })).toEqual({ kind: "none" });
  });

  test("should return none when every key that was used has been revoked", async () => {
    const toAgentConnection = await loadToAgentConnection();

    // The ordering of the two branches is the whole assertion: an org whose only
    // used key is revoked has no key, so it reads none and never connected.
    expect(toAgentConnection({ liveCount: 0, anyUsed: true })).toEqual({ kind: "none" });
    expect(toAgentConnection({ liveCount: 0, anyUsed: true })).not.toEqual({ kind: "connected" });
  });

  test("should carry no key id, prefix, name or timestamp on any member", async () => {
    const toAgentConnection = await loadToAgentConnection();

    const summaries: readonly ApiKeyUseSummary[] = [
      { liveCount: 0, anyUsed: false },
      { liveCount: 0, anyUsed: true },
      { liveCount: 1, anyUsed: false },
      { liveCount: 2, anyUsed: true },
    ];

    const widened = summaries
      .map((use) => Object.keys(toAgentConnection(use)).toSorted())
      .filter((keys) => keys.length !== 1 || keys[0] !== "kind");

    expect(widened).toEqual([]);
  });
});
