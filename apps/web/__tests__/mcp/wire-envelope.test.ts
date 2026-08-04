import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import { JSON_RPC_ERROR_CODE } from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  notificationRequest,
  rawBodyRequest,
  rpcRequest,
  toolCallRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
} from "./helpers/mcp-fixture";
import { watchForUnhandledRejections } from "./helpers/wire-probes";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: { credentials: CREDENTIALS, reads: spy.port } };
}

const JSONRPC_MARKER = '"jsonrpc":"2.0"';

function errorCodeMarker(code: number): string {
  return `"code":${code}`;
}

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

describe("WIRE-W1 — a batch request is answered without crashing the handler", () => {
  test("an array body comes back as a response below 500, with something in it", async () => {
    const { deps } = spyDeps();

    const watched = await watchForUnhandledRejections(async () =>
      handleMcpRequest(
        rawBodyRequest('[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]', KEY_A),
        deps,
      ),
    );
    const print = await fingerprint(watched.result);

    expect(print.status).toBeLessThan(500);
    expect(print.body.length).toBeGreaterThan(0);

    expect(watched.unhandled).toEqual([]);
  });
});

describe("WIRE-W2 — a request with a null id is answered rather than dropped", () => {
  test("id: null comes back as a JSON-RPC message, not an empty body", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/list", id: null, key: KEY_A }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.body.length).toBeGreaterThan(0);
    expect(print.body).toContain(JSONRPC_MARKER);
  });
});

describe("WIRE-W3 — a body missing the jsonrpc field is refused as an invalid request", () => {
  test("carries the invalid-request code and never a 500", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rawBodyRequest('{"id":1,"method":"tools/list"}', KEY_A),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.body).toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.INVALID_REQUEST));
    expect(print.status).toBeLessThan(500);
  });
});

describe("WIRE-W4 — a notification with no id is answered with no JSON-RPC message", () => {
  test("yields a zero-length body and a status below 300", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      notificationRequest({ method: "notifications/initialized", key: KEY_A }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.status).toBeLessThan(300);
    expect(print.body.length).toBe(0);
  });
});

describe("WIRE-W5 — an unknown method is refused with method-not-found and never a 500", () => {
  test("answers tools/destroy with method-not-found, below 500, and asks the port nothing", async () => {
    const { spy, deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/destroy", key: KEY_A }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.body).toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.METHOD_NOT_FOUND));
    expect(print.status).toBeLessThan(500);
    expect(spy.organizationsAsked).toEqual([]);
  });
});

describe("WIRE-W6 — a request with no params at all is answered rather than thrown on", () => {
  test("tools/list with no params comes back as a JSON-RPC message", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.body).toContain(JSONRPC_MARKER);
  });

  test("tools/call with no params comes back as a JSON-RPC message rather than a fault", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/call", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.body).toContain(JSONRPC_MARKER);
    expect(print.status).toBeLessThan(500);
  });
});

describe("WIRE-W7 — malformed JSON is refused as a parse error before any tool is resolved", () => {
  test("answers with the parse-error code and asks the port nothing", async () => {
    const { spy, deps } = spyDeps();

    const response = await handleMcpRequest(
      rawBodyRequest('{"jsonrpc":"2.0","id":1,"method":', KEY_A),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.body).toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.PARSE_ERROR));
    expect(spy.organizationsAsked).toEqual([]);
  });
});

describe("WIRE-W8 — two identical tool calls produce two identical answers and no second effect", () => {
  test("two calls with the same id are byte-identical, and the port is read exactly twice", async () => {
    const { spy, deps } = spyDeps();

    const first = await handleMcpRequest(
      toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
      deps,
    );
    const second = await handleMcpRequest(
      toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
      deps,
    );

    const firstPrint = await fingerprint(first);
    const secondPrint = await fingerprint(second);

    expect(firstPrint.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(firstPrint).toEqual(secondPrint);

    expect(spy.organizationsAsked).toEqual([ORG_A, ORG_A]);
  });

  test("the only port the surface has is the read port, and it has four read methods", () => {
    const { spy } = spyDeps();

    expect(Object.keys(spy.port).toSorted()).toEqual([
      "getFinding",
      "getFix",
      "getGrowthContext",
      "listOpenFixes",
    ]);
  });
});
