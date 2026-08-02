import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, spyOn, test } from "bun:test";

import { UNAVAILABLE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  fakeCredentials,
  throwingReadPort,
  toolCallRequest,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";
import {
  carriesFilePath,
  carriesStackFrame,
  watchForUnhandledRejections,
} from "./helpers/wire-probes";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function brokenReadDeps(): McpServerDeps {
  return { credentials: CREDENTIALS, reads: throwingReadPort() };
}

describe("WIRE-B1 — a read that throws becomes a detail-free answer with the fault logged", () => {
  test("answers with the unavailable sentence, carries no stack frame or file path, and logs once", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
        brokenReadDeps(),
      );
      const body = await response.text();

      expect(body).toContain(UNAVAILABLE.message);

      expect(carriesStackFrame(body)).toBe(false);
      expect(carriesFilePath(body)).toBe(false);
      expect(body).not.toContain("mcp fixture");

      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("the leak scanners do fire on the fixture's own error text and a stack frame", () => {
    const leaky =
      "Error: mcp fixture: the read port is unreachable\n    at listOpenFixes (apps/web/lib/mcp/call-tool.ts:70:11)";

    expect(carriesStackFrame(leaky)).toBe(true);
    expect(carriesFilePath(leaky)).toBe(true);
    expect(carriesStackFrame(UNAVAILABLE.message)).toBe(false);
    expect(carriesFilePath(UNAVAILABLE.message)).toBe(false);
  });
});

describe("WIRE-B2 — no unhandled rejection escapes the mounted handler", () => {
  test("a rejecting port still comes back as a Response, with nothing left unhandled", async () => {
    const watched = await watchForUnhandledRejections(async () =>
      handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "fix-anything" }, key: KEY_A }),
        brokenReadDeps(),
      ),
    );

    expect(watched.result).toBeInstanceOf(Response);

    expect(await watched.result.text()).toContain(UNAVAILABLE.message);

    expect(watched.unhandled).toEqual([]);
  });
});
