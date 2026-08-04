"use client";

import { createContext, useContext } from "react";

import type { AgentConnection, AgentProviderId } from "@growthmind/shared";

// Its own module rather than FirstRunClient's: the island renders the panel
// itself once armed, so a context exported from there would be a cycle.
export const LiveAgentConnection = createContext<AgentConnection | null>(null);

// First contact is stamped outside the browser, so the poll is the only thing
// that ever notices it. The panel reads this, never its own client state.
export function useLiveAgentConnection(fallback: AgentConnection): AgentConnection {
  return useContext(LiveAgentConnection) ?? fallback;
}

export interface AgentPanelHold {
  readonly rawKey: string | null;
  readonly provider: AgentProviderId | null;
}

export interface HeldAgentPanel {
  readonly hold: AgentPanelHold;
  readonly setHold: (next: AgentPanelHold) => void;
}

export const EMPTY_HOLD: AgentPanelHold = { rawKey: null, provider: null };

// Arming swaps one panel instance for another, and the key it holds is shown once.
export const HeldAgentPanelContext = createContext<HeldAgentPanel | null>(null);

export function useHeldAgentPanel(): HeldAgentPanel | null {
  return useContext(HeldAgentPanelContext);
}
