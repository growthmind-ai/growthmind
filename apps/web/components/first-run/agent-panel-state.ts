// The UX §7.1 machine as a pure function (ADD O-026 D-12), the sibling of
// chip-state.ts. Precedence is the contract: this visit's action beats the
// payload the page still holds, and the reveal is client memory — a payload
// arriving with no raw key in memory is `waiting`, never `reveal`.

import type { AgentConnection } from "@growthmind/shared";

export type AgentPanelState =
  | "choose"
  | "minting"
  | "reveal"
  | "waiting"
  | "connected"
  | "error"
  | "revoked"
  | "revoke-confirm";

export type AgentPanelAction = "idle" | "minting" | "failed" | "revoked" | "confirming-revoke";

export interface AgentPanelStateInput {
  readonly connection: AgentConnection;
  readonly rawKey: string | null;
  readonly action: AgentPanelAction;
}

export function resolveAgentPanelState(input: AgentPanelStateInput): AgentPanelState {
  if (input.action === "minting") {
    return "minting";
  }
  if (input.action === "failed") {
    return "error";
  }
  if (input.action === "confirming-revoke") {
    return "revoke-confirm";
  }
  if (input.action === "revoked") {
    return "revoked";
  }
  if (input.rawKey !== null) {
    return "reveal";
  }
  if (input.connection.kind === "connected") {
    return "connected";
  }
  if (input.connection.kind === "waiting") {
    return "waiting";
  }

  return "choose";
}
