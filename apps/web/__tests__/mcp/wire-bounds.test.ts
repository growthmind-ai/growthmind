import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, spyOn, test } from "bun:test";

import { BODY_TOO_LARGE, MALFORMED_BODY, UNAVAILABLE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rawBodyRequest,
  throwingReadPort,
  toolCallRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
} from "./helpers/mcp-fixture";
import { modernRequest } from "./helpers/modern-envelope";
import { watchForUnhandledRejections } from "./helpers/wire-probes";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: { credentials: CREDENTIALS, reads: spy.port } };
}

const BOUNDED_MS = 5000;

const NEVER_ANSWERED = Symbol("mcpl: the request was never answered");

async function answeredWithin(
  run: () => Promise<Response>,
  ms: number,
): Promise<Response | typeof NEVER_ANSWERED> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof NEVER_ANSWERED>((resolve) => {
    watchdog = setTimeout(() => resolve(NEVER_ANSWERED), ms);
  });

  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (watchdog !== undefined) {
      clearTimeout(watchdog);
    }
  }
}

const LISTEN_PARAMS = {
  notifications: { toolsListChanged: true },
} as const;

describe("WIRE-L1 — a modern subscriptions/listen is answered in bounded time rather than held open", () => {
  test("answers within the bound, with a body, and asks the port nothing", async () => {
    const { spy, deps } = spyDeps();

    const answer = await answeredWithin(
      () =>
        handleMcpRequest(
          modernRequest({ method: "subscriptions/listen", params: LISTEN_PARAMS, key: KEY_A }),
          deps,
        ),
      BOUNDED_MS,
    );

    expect(answer).not.toBe(NEVER_ANSWERED);

    const print = await fingerprint(answer as Response);
    expect(print.body.length).toBeGreaterThan(0);

    expect(spy.organizationsAsked).toEqual([]);
  });

  test("refuses it in band, on a 200, rather than as a transport failure", async () => {
    const { deps } = spyDeps();

    const answer = await answeredWithin(
      () =>
        handleMcpRequest(
          modernRequest({ method: "subscriptions/listen", params: LISTEN_PARAMS, key: KEY_A }),
          deps,
        ),
      BOUNDED_MS,
    );
    expect(answer).not.toBe(NEVER_ANSWERED);

    const print = await fingerprint(answer as Response);
    expect(print.status).toBe(200);
    expect(print.body).toContain("Subscription limit reached");
  });
});

describe("WIRE-L2 — many concurrent subscriptions/listen requests all answer", () => {
  test("ten at once all come back, and nothing is left unhandled", async () => {
    const { deps } = spyDeps();

    const watched = await watchForUnhandledRejections(async () =>
      Promise.all(
        Array.from({ length: 10 }, async (_unused, index) =>
          answeredWithin(
            () =>
              handleMcpRequest(
                modernRequest({
                  method: "subscriptions/listen",
                  params: LISTEN_PARAMS,
                  key: KEY_A,
                  id: index,
                }),
                deps,
              ),
            BOUNDED_MS,
          ),
        ),
      ),
    );

    expect(watched.result).toHaveLength(10);
    for (const answer of watched.result) {
      expect(answer).not.toBe(NEVER_ANSWERED);
    }
    expect(watched.unhandled).toEqual([]);
  });
});

function batchOf(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_unused, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "tools/call",
      params: { name: MCP_TOOL.LIST_OPEN_FIXES, arguments: {} },
    })),
  );
}

function oversizeBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: MCP_TOOL.GET_FIX, arguments: { fixId: "x".repeat(2 * 1024 * 1024) } },
  });
}

describe("WIRE-L3 — a JSON-RPC batch is refused before it can buy any work", () => {
  test("a 500-message batch is refused 400 with the single-message instruction, and the port is untouched", async () => {
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest(batchOf(500), KEY_A), deps),
    );

    expect(print.status).toBe(MALFORMED_BODY.status);
    expect(print.body).toContain(MALFORMED_BODY.message);

    expect(spy.organizationsAsked).toEqual([]);
  });

  test("a one-message batch is refused too, so the gate is about the shape and not the size", async () => {
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest(batchOf(1), KEY_A), deps),
    );

    expect(print.status).toBe(MALFORMED_BODY.status);
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("leading whitespace does not smuggle a batch past the gate", async () => {
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest(`  \n\t${batchOf(2)}`, KEY_A), deps),
    );

    expect(print.status).toBe(MALFORMED_BODY.status);
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("a single message whose arguments contain an array is still served", async () => {
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(
        toolCallRequest({
          tool: MCP_TOOL.LIST_OPEN_FIXES,
          input: { projectId: "project-mcpl", limit: 5, extras: [1, 2, 3] },
          key: KEY_A,
        }),
        deps,
      ),
    );

    expect(print.status).toBe(200);
    expect(print.body).not.toContain(MALFORMED_BODY.message);
    expect(spy.organizationsAsked).toEqual([ORG_A]);
  });
});

describe("WIRE-L4 — a body bigger than this surface could ever need is refused before it is buffered", () => {
  test("a two-megabyte body is refused 413 with the sentence that says what to send instead", async () => {
    const { spy, deps } = spyDeps();

    const body = oversizeBody();
    expect(body.length).toBeGreaterThan(1024 * 1024);

    const print = await fingerprint(await handleMcpRequest(rawBodyRequest(body, KEY_A), deps));

    expect(print.status).toBe(BODY_TOO_LARGE.status);
    expect(print.body).toContain(BODY_TOO_LARGE.message);
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("an ordinary call is still served, so the ceiling refuses nothing real", async () => {
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }), deps),
    );

    expect(print.status).toBe(200);
    expect(print.body).not.toContain(BODY_TOO_LARGE.message);
    expect(spy.organizationsAsked).toEqual([ORG_A]);
  });

  test("the refusal names neither a stack frame nor a size in bytes", async () => {
    expect(BODY_TOO_LARGE.message).toContain("megabyte");
    expect(BODY_TOO_LARGE.message).not.toContain("1048576");
    expect(Object.isFrozen(BODY_TOO_LARGE)).toBe(true);
  });
});

describe("WIRE-L5 — reading the body to gate it does not change what the transport sees", () => {
  test("a malformed body still reaches the transport's parser, byte for byte", async () => {
    const { deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest('{"jsonrpc":"2.0","id":1,"method":', KEY_A), deps),
    );

    expect(print.body).toContain("-32700");
  });

  test("a well-formed call answers exactly as it did before the body was ever read", async () => {
    const { deps } = spyDeps();

    const first = await fingerprint(
      await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "a" }, key: KEY_A }),
        deps,
      ),
    );
    const second = await fingerprint(
      await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "a" }, key: KEY_A }),
        deps,
      ),
    );

    expect(first.status).toBe(200);
    expect(first.contentType).toBe("text/event-stream");

    expect(first).toEqual(second);
  });
});

const TRANSPORT_CHANNEL_MARKER = "transport";

function firstLoggedMessage(spy: ReturnType<typeof spyOn<Console, "error">>): string {
  return String(spy.mock.calls[0]?.[0] ?? "");
}

describe("WIRE-L7 — a fault the SDK reports reaches a log line of ours", () => {
  test("a transport-level refusal logs exactly once, naming the transport", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { deps } = spyDeps();

      const answer = await answeredWithin(
        () =>
          handleMcpRequest(
            modernRequest({ method: "subscriptions/listen", params: LISTEN_PARAMS, key: KEY_A }),
            deps,
          ),
        BOUNDED_MS,
      );
      expect(answer).not.toBe(NEVER_ANSWERED);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(firstLoggedMessage(errorSpy)).toContain(TRANSPORT_CHANNEL_MARKER);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("WIRE-L8 — a broken read still belongs to the tool core's channel and not the transport's", () => {
  test("logs once, and the line is not the transport's", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
        { credentials: CREDENTIALS, reads: throwingReadPort() },
      );

      expect(await response.text()).toContain(UNAVAILABLE.message);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(firstLoggedMessage(errorSpy)).not.toContain(TRANSPORT_CHANNEL_MARKER);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
