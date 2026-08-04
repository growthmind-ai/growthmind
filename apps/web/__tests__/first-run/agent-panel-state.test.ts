import { describe, expect, test } from "bun:test";

import {
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";

const OWNER =
  "ADD O-026 D-12 (apps/web/components/first-run/agent-panel-state.ts — the UX §7.1 machine as " +
  "a pure function, the sibling of chip-state.ts)";

// The eight states UX §7.1 enumerates. Declared here because the production
// module does not exist yet; Wave N's export replaces this shape, not this list.
type AgentPanelState =
  | "choose"
  | "minting"
  | "reveal"
  | "waiting"
  | "connected"
  | "error"
  | "revoked"
  | "revoke-confirm";

type AgentConnection = { readonly kind: "none" | "waiting" | "connected" };

type AgentPanelAction = "idle" | "minting" | "failed" | "revoked" | "confirming-revoke";

interface AgentPanelStateInput {
  readonly connection: AgentConnection;
  readonly rawKey: string | null;
  readonly action: AgentPanelAction;
}

type ResolveAgentPanelState = (input: AgentPanelStateInput) => AgentPanelState;

const loadResolver = (): Promise<ResolveAgentPanelState> =>
  loadValueUnderConstruction<ResolveAgentPanelState>({
    modulePath: underConstructionSpecifier("apps/web/components/first-run/agent-panel-state"),
    exportName: "resolveAgentPanelState",
    ownedBy: OWNER,
  });

const REVEALED_KEY = "gmak_a-fixture-key-that-is-not-a-real-credential";

const atRest = (connection: AgentConnection["kind"]): AgentPanelStateInput => ({
  connection: { kind: connection },
  rawKey: null,
  action: "idle",
});

describe("resolveAgentPanelState — the payload-derived states (AC-22, D4)", () => {
  test("resolves every payload-derived state with no client state at all", async () => {
    const resolveAgentPanelState = await loadResolver();

    const expected: readonly (readonly [AgentConnection["kind"], AgentPanelState])[] = [
      ["none", "choose"],
      ["waiting", "waiting"],
      ["connected", "connected"],
    ];

    for (const [kind, state] of expected) {
      const resolved = resolveAgentPanelState(atRest(kind));
      expect(`${kind}: ${resolved}`).toBe(`${kind}: ${state}`);
    }
  });
});

describe("resolveAgentPanelState — the reveal is client memory, never the payload (UX §7.1)", () => {
  test("shows the reveal only while a raw key is held in this page's memory", async () => {
    const resolveAgentPanelState = await loadResolver();

    const held = resolveAgentPanelState({
      connection: { kind: "waiting" },
      rawKey: REVEALED_KEY,
      action: "idle",
    });
    expect(held).toBe("reveal");
  });

  test("falls back to waiting when the same payload arrives with no key in memory", async () => {
    const resolveAgentPanelState = await loadResolver();

    const gone = resolveAgentPanelState({
      connection: { kind: "waiting" },
      rawKey: null,
      action: "idle",
    });
    expect(gone).toBe("waiting");
  });
});

describe("resolveAgentPanelState — the action states (UX §7.1)", () => {
  test("renders minting while a mint is in flight", async () => {
    const resolveAgentPanelState = await loadResolver();

    expect(
      resolveAgentPanelState({ connection: { kind: "none" }, rawKey: null, action: "minting" }),
    ).toBe("minting");
  });

  test("renders error when the mint was refused or the network failed", async () => {
    const resolveAgentPanelState = await loadResolver();

    expect(
      resolveAgentPanelState({ connection: { kind: "none" }, rawKey: null, action: "failed" }),
    ).toBe("error");
  });

  test("renders revoked after a revoke, beating the payload the page still holds", async () => {
    const resolveAgentPanelState = await loadResolver();

    expect(
      resolveAgentPanelState({ connection: { kind: "waiting" }, rawKey: null, action: "revoked" }),
    ).toBe("revoked");
  });

  test("renders revoke-confirm while the consequence is being confirmed", async () => {
    const resolveAgentPanelState = await loadResolver();

    expect(
      resolveAgentPanelState({
        connection: { kind: "connected" },
        rawKey: null,
        action: "confirming-revoke",
      }),
    ).toBe("revoke-confirm");
  });
});
