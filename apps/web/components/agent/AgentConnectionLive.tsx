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
  // The answer carries the server value it was asked against. A server render is newer than
  // anything polled before it — minting and revoking both refresh — so when that value moves
  // the stale answer stops matching and is ignored, derived here rather than reset in an
  // effect (`react-hooks/set-state-in-effect`).
  const [answer, setAnswer] = useState<{
    readonly against: AgentConnection["kind"];
    readonly value: AgentConnection;
  } | null>(null);

  const connection = answer !== null && answer.against === initial.kind ? answer.value : initial;
  const watching = agentStillWatched({ connection, heldKey: null });

  useEffect(() => {
    if (!watching) {
      return undefined;
    }

    let mounted = true;

    const timer = setInterval(() => {
      void readAgentConnection().then((next) => {
        if (mounted && next !== null) setAnswer({ against: initial.kind, value: next });
      });
    }, PRE_ARM_POLL_MS);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [watching, initial.kind]);

  return <LiveAgentConnection value={connection}>{children}</LiveAgentConnection>;
}
