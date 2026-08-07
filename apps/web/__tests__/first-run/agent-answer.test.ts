import { describe, expect, test } from "bun:test";

import type { AgentConnection } from "@growthmind/shared";

import {
  agentAnswerAt,
  initialAgentAnswer,
  shownConnection,
  withPolledAnswer,
} from "../../lib/first-run/agent-answer";

const NONE: AgentConnection = { kind: "none" };
const WAITING: AgentConnection = { kind: "waiting" };
const CONNECTED: AgentConnection = { kind: "connected" };

// The panel's whole state machine, replayed as the sequence of things that happen to it: a
// server render hands it a value, and a poll hands it an answer. There is no DOM renderer in
// this repo, so the rule that decides what is shown is tested where it lives.
function replay(
  steps: readonly ({ readonly server: AgentConnection } | { readonly polled: AgentConnection })[],
): AgentConnection {
  let state = initialAgentAnswer(NONE);
  let server = NONE;

  for (const step of steps) {
    if ("server" in step) {
      server = step.server;
      state = agentAnswerAt(state, server);
      continue;
    }
    state = withPolledAnswer(state, step.polled);
  }

  return shownConnection(state, server);
}

describe("the agent panel's live answer (B-048)", () => {
  test("shows connected for a key the assistant has called", () => {
    // Anti-vacuity: the panel's reason for existing still works. Without this the fix could be
    // "never trust a poll", which would restore the stuck `waiting` the panel was built to avoid.
    expect(replay([{ server: WAITING }, { polled: CONNECTED }])).toEqual(CONNECTED);
  });

  test("does not show connected for a key minted after a revoke", () => {
    // The reported repro. `waiting → connected → none → waiting` returns the server value to
    // what it already was, so a rule comparing against a captured value matched the stale
    // answer a second time and rendered `connected` against a key nothing had ever called.
    const afterReMint = replay([
      { server: WAITING },
      { polled: CONNECTED },
      { server: NONE },
      { server: WAITING },
    ]);

    expect(afterReMint).toEqual(WAITING);
    expect(afterReMint).not.toEqual(CONNECTED);
  });

  test("keeps a polled answer while the server keeps saying the same thing", () => {
    // A re-render that carries the same server value is not news, and dropping the answer on
    // one would put the panel back to `waiting` a beat after it went `connected`.
    expect(replay([{ server: WAITING }, { polled: CONNECTED }, { server: WAITING }])).toEqual(
      CONNECTED,
    );
  });

  test("follows the server the moment it disagrees with what was polled", () => {
    // Revoke while the panel reads connected: the next server render is the truth, and it wins
    // immediately rather than after the interval that has already stopped ticking.
    expect(replay([{ server: WAITING }, { polled: CONNECTED }, { server: NONE }])).toEqual(NONE);
  });

  test("cannot be resurrected by a second poll against a stale server value", () => {
    const state = agentAnswerAt(withPolledAnswer(initialAgentAnswer(WAITING), CONNECTED), NONE);

    expect(state.answer).toBeNull();
    expect(shownConnection(state, NONE)).toEqual(NONE);
  });
});
