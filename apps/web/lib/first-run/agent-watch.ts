import type { AgentConnection } from "@growthmind/shared";

export interface AgentWatchInput {
  readonly connection: AgentConnection;

  readonly heldKey: string | null;
}

// A key minted in this tab is in flight before any payload says so: the render
// that carried the connection was served before the press that made the key.
export function agentStillWatched(input: AgentWatchInput): boolean {
  if (input.connection.kind === "connected") {
    return false;
  }

  return input.connection.kind === "waiting" || input.heldKey !== null;
}
