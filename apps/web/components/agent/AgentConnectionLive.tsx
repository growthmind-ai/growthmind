"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { AgentConnection } from "@growthmind/shared";

import { readAgentConnection } from "@/components/first-run/api";
import { LiveAgentConnection } from "@/components/first-run/live-agent";
import { useLiveTopics } from "@/components/live/LiveRefresh";
import { agentStillWatched } from "@/lib/first-run/poll-cadence";

interface AgentConnectionLiveProps {
  readonly initial: AgentConnection;
  readonly children: ReactNode;
}

// Without this a founder pastes the block, the assistant calls, and the page still reads
// `waiting` until they think to reload — the stuck-state class this panel was built to
// avoid. The assistant's first call stamps the key, which publishes; nothing asks.
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

  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useLiveTopics(watching ? ["agent_connection"] : [], () => {
    void readAgentConnection().then((next) => {
      if (live.current && next !== null) setAnswer({ against: initial.kind, value: next });
    });
  });

  return <LiveAgentConnection value={connection}>{children}</LiveAgentConnection>;
}
