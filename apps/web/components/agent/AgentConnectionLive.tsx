"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { AgentConnection } from "@growthmind/shared";

import { readAgentConnection } from "@/components/first-run/api";
import { LiveAgentConnection } from "@/components/first-run/live-agent";
import { useLiveTopics } from "@/components/live/LiveRefresh";
import {
  agentAnswerAt,
  initialAgentAnswer,
  shownConnection,
  withPolledAnswer,
} from "@/lib/first-run/agent-answer";
import { agentStillWatched } from "@/lib/first-run/poll-cadence";

interface AgentConnectionLiveProps {
  readonly initial: AgentConnection;
  readonly children: ReactNode;
}

// Without this a founder pastes the block, the assistant calls, and the page still reads
// `waiting` until they think to reload — the stuck-state class this panel was built to
// avoid. The assistant's first call stamps the key, which publishes; nothing asks.
export function AgentConnectionLive({ initial, children }: AgentConnectionLiveProps) {
  // The answer is dropped when the server value moves, derived here rather than reset in an
  // effect (`react-hooks/set-state-in-effect`). Comparing against a captured value instead
  // is what let a stale `connected` render against a freshly minted key (B-048).
  const [state, setState] = useState(() => initialAgentAnswer(initial));

  const atThisRender = agentAnswerAt(state, initial);
  if (atThisRender !== state) setState(atThisRender);

  const connection = shownConnection(atThisRender, initial);
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
      if (live.current && next !== null) {
        setState((current) => withPolledAnswer(current, next));
      }
    });
  });

  return <LiveAgentConnection value={connection}>{children}</LiveAgentConnection>;
}
