"use client";

import { createContext, useContext } from "react";

import type { AgentConnection } from "@growthmind/shared";

// Its own module rather than FirstRunClient's: the island renders the panel
// itself once armed, so a context exported from there would be a cycle.
export const LiveAgentConnection = createContext<AgentConnection | null>(null);

// First contact is stamped outside the browser, so the poll is the only thing
// that ever notices it. The panel reads this, never its own client state.
export function useLiveAgentConnection(fallback: AgentConnection): AgentConnection {
  return useContext(LiveAgentConnection) ?? fallback;
}
