// The browser half of the connection read. Every failure answers `null` so the caller keeps
// the connection it holds — a parser that guessed `none` on a bad answer would tell a
// connected org to mint a second key, which is the fail direction the route already refuses.
import { afterEach, describe, expect, test } from "bun:test";

import { AGENT_API, readAgentConnection } from "../../components/first-run/api";

const realFetch = globalThis.fetch;

function answering(status: number, body: unknown): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("readAgentConnection — the shapes a page can be handed (D5)", () => {
  test("it asks the one path, and reads each of the three kinds back", async () => {
    expect(AGENT_API.connection).toBe("/api/agent/connection");

    for (const kind of ["none", "waiting", "connected"] as const) {
      globalThis.fetch = answering(200, { connection: { kind } });
      expect(await readAgentConnection()).toEqual({ kind });
    }
  });

  test("a refusal, a dead transport and an unknown kind all answer null, never a guess", async () => {
    globalThis.fetch = answering(503, { refusal: { code: "connection_unreadable" } });
    expect(await readAgentConnection()).toBeNull();

    globalThis.fetch = answering(200, { connection: { kind: "revoked" } });
    expect(await readAgentConnection()).toBeNull();

    globalThis.fetch = answering(200, { connection: null });
    expect(await readAgentConnection()).toBeNull();

    globalThis.fetch = answering(200, {});
    expect(await readAgentConnection()).toBeNull();

    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    expect(await readAgentConnection()).toBeNull();
  });
});
