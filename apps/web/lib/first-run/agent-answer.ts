import type { AgentConnection } from "@growthmind/shared";

export interface AgentAnswerState {
  readonly seenKind: AgentConnection["kind"];

  readonly answer: AgentConnection | null;
}

export function initialAgentAnswer(serverValue: AgentConnection): AgentAnswerState {
  return { seenKind: serverValue.kind, answer: null };
}

// A polled answer survives until the server says something different, and `different` has to
// mean the value MOVED rather than that it stops equalling what was captured. `waiting →
// connected → none → waiting` returns the server value to what it already was, so an equality
// test matches a second time and renders the `connected` captured before the revoke against a
// key nothing has ever called (B-048). Three members means every value comes back.
export function agentAnswerAt(
  state: AgentAnswerState,
  serverValue: AgentConnection,
): AgentAnswerState {
  return state.seenKind === serverValue.kind ? state : initialAgentAnswer(serverValue);
}

export function withPolledAnswer(
  state: AgentAnswerState,
  polled: AgentConnection,
): AgentAnswerState {
  return { seenKind: state.seenKind, answer: polled };
}

export function shownConnection(
  state: AgentAnswerState,
  serverValue: AgentConnection,
): AgentConnection {
  return state.answer ?? serverValue;
}
