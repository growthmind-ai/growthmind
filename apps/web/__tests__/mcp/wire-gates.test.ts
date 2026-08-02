import { MCP_TOOL, MCP_TOOLS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { BROWSER_ORIGIN, UNAUTHENTICATED, WRONG_CONTENT_TYPE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import { MCP_HEADER } from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rpcRequest,
  toolCallRequest,
  verbRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
} from "./helpers/mcp-fixture";
import { carriesFilePath, carriesStackFrame } from "./helpers/wire-probes";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: { credentials: CREDENTIALS, reads: spy.port } };
}

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

const REQUIRED_MEDIA_TYPES = ["application/json", "text/event-stream"] as const;

describe("WIRE-G1 — a request carrying a browser origin is refused before the body is read", () => {
  test("an authenticated tools/list with an Origin header is refused 403, and the port is untouched", async () => {
    const { spy, deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/list", key: KEY_A, headers: { origin: "http://evil.example" } }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.status).toBe(403);
    expect(print.body).toContain(BROWSER_ORIGIN.message);
    expect(spy.organizationsAsked).toEqual([]);
  });
});

describe("WIRE-G2 — a request with no origin header is served, so a self-hosted stack works on any hostname", () => {
  test("the identical request minus Origin answers with the three tools", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    for (const tool of MCP_TOOLS) {
      expect(print.body).toContain(tool.name);
    }
    expect(print.body).not.toContain(BROWSER_ORIGIN.message);
  });
});

describe("WIRE-G3 — a request that does not arrive as JSON is refused with the content type named", () => {
  test("content-type: text/plain is refused 415 with the sentence that says what to send", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({
        method: "tools/list",
        key: KEY_A,
        headers: { [MCP_HEADER.CONTENT_TYPE]: "text/plain" },
      }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.status).toBe(415);
    expect(print.body).toContain(WRONG_CONTENT_TYPE.message);
  });

  test("the same request as JSON is still served", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(200);
    expect(print.body).not.toContain(WRONG_CONTENT_TYPE.message);
  });
});

describe("WIRE-G5 — no response ever carries a session id header", () => {
  const cases: readonly {
    readonly name: string;
    readonly status: number;
    readonly run: (deps: McpServerDeps) => Promise<Response>;
  }[] = [
    {
      name: "a tools/list",
      status: 200,
      run: (deps) => handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps),
    },
    {
      name: "a tools/call",
      status: 200,
      run: (deps) =>
        handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }), deps),
    },
    {
      name: "an unauthenticated refusal",
      status: 401,
      run: (deps) => handleMcpRequest(rpcRequest({ method: "tools/list" }), deps),
    },
    {
      name: "a wrong-method refusal",
      status: 405,
      run: (deps) => handleMcpRequest(verbRequest({ method: "DELETE", key: KEY_A }), deps),
    },
  ];

  for (const { name, status, run } of cases) {
    test(`${name} carries no session id header`, async () => {
      const { deps } = spyDeps();

      const response = await run(deps);

      expect(response.status).toBe(status);
      expect(response.headers.get(MCP_HEADER.SESSION_ID)).toBe(null);
    });
  }
});

describe("WIRE-G6 — a LEGACY-leg request that will not accept both media types is refused by the transport with a sentence that says which, and never before the credential is checked", () => {
  const NARROWED_ACCEPT = { accept: "application/json" } as const;

  test("(a) an authenticated tools/list that accepts only JSON is refused 406, naming both media types", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/list", key: KEY_A, headers: NARROWED_ACCEPT }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.status).toBe(406);
    for (const mediaType of REQUIRED_MEDIA_TYPES) {
      expect(print.body).toContain(mediaType);
    }

    expect(carriesStackFrame(print.body)).toBe(false);
    expect(carriesFilePath(print.body)).toBe(false);
  });

  test("(a) the leak scanners do find a stack frame and a file path in a known-positive control", () => {
    const leaky =
      "TypeError: x is not a function\n    at renderMcpWire (apps/web/lib/mcp/wire.ts:97:9)";

    expect(carriesStackFrame(leaky)).toBe(true);
    expect(carriesFilePath(leaky)).toBe(true);

    expect(carriesStackFrame(BROWSER_ORIGIN.message)).toBe(false);
    expect(carriesFilePath("the window ran from 2026-06-01T00:00:00.000Z")).toBe(false);
  });

  test("(b) the identical request with no credential is answered 401 instead, exactly as a full-Accept request is", async () => {
    const { deps } = spyDeps();

    const narrowed = await fingerprint(
      await handleMcpRequest(rpcRequest({ method: "tools/list", headers: NARROWED_ACCEPT }), deps),
    );
    const full = await fingerprint(
      await handleMcpRequest(rpcRequest({ method: "tools/list" }), deps),
    );

    expect(narrowed.status).toBe(401);
    expect(narrowed.body).toContain(UNAUTHENTICATED.message);

    expect(narrowed).toEqual(full);
  });

  test("(c) the same request accepting both media types is served", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
  });
});
