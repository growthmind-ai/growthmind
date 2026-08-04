"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { AgentConnection } from "@growthmind/shared";

import { readAgentConnection } from "@/components/first-run/api";
import { LiveAgentConnection } from "@/components/first-run/live-agent";
import { agentStillWatched, PRE_ARM_POLL_MS } from "@/lib/first-run/poll-cadence";

interface AgentConnectionLiveProps {
  readonly initial: AgentConnection;
  readonly children: ReactNode;
}

// The island first-run gets from its own poll, for every surface that has none. Without it
// a founder pastes the block, the assistant calls, and the page still reads `waiting` until
// they think to reload — the stuck-state class this panel was built to avoid.
export function AgentConnectionLive({ initial, children }: AgentConnectionLiveProps) {
  const [polled, setPolled] = useState<AgentConnection | null>(null);

  // A server render is newer than anything asked for before it: minting and revoking both
  // refresh, so the value that arrives on this prop wins and the polled one is dropped.
  useEffect(() => setPolled(null), [initial.kind]);

  const connection = polled ?? initial;
  const watching = agentStillWatched({ connection, heldKey: null });

  useEffect(() => {
    if (!watching) {
      return undefined;
    }

    let mounted = true;

    const timer = setInterval(() => {
      void readAgentConnection().then((next) => {
        if (mounted && next !== null) setPolled(next);
      });
    }, PRE_ARM_POLL_MS);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [watching]);

  return <LiveAgentConnection value={connection}>{children}</LiveAgentConnection>;
}
