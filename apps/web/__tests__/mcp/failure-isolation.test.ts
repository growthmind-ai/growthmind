// When the read breaks. WIRE-B1 / WIRE-B2.
//
// A tool call is a main operation with a fault line running through it: the read can
// fail. What happens then is not a detail. It is the difference between a coding agent
// that reports "the server is having a problem, try later" and one that pastes a stack
// trace naming our files into a customer's terminal, or worse, hangs because a
// rejection escaped the handler and no answer was ever framed.
//
// Two rows, one fake:
//
// B1 the answer is detail-free and the fault is logged where logs are ours
// B2 nothing escapes the mounted handler as an unhandled rejection
//
// `throwingReadPort` lives in the fixture rather than here because three rows need
// the same fake (these two and `WIRE-S5`) and three hand-rolled copies would be three
// chances to throw a subtly different thing and prove three different properties. Its
// message names the fixture, so a leaked frame is unmistakable in the scan below.
//
// Why both rows assert the port was actually reached
//
// Both claims are about what happens after a read throws, and both are satisfied
// trivially by a surface that never reads at all, which is exactly what this surface
// does today, because a JSON-RPC body reaches the Wave 0 route as an object with no
// `tool` key and comes back as a 400 before any port is touched. A row that only
// asserted "no unhandled rejection" would be green now, green through wave 8, and green
// forever after somebody accidentally disconnected the read port.
//
// So each row establishes first that the answer is the one the broken read produced,
// `UNAVAILABLE.message`, the sentence that only exists on that path, and asserts the
// absence afterwards.
//
// Both are green, and a third log channel has since been added beside them
//
// These rows were authored red: task 7.1 gave `callTool` the catch that turns a broken
// read into `{ ok: false, refusal: UNAVAILABLE }` and task 8.1 renders it as a tool
// execution error. Both landed; both rows pass.
//
// `WIRE-B1`'s "exactly one" is now load-bearing against a third channel. The
// post-sprint audit wired an `onerror` into the transport, because a fault inside the
// SDK is returned rather than thrown and was therefore invisible to every catch we had.
// That channel must stay silent on this path, `callTool` catches its own fault and
// returns a value, so nothing throws into the SDK, and if it ever speaks here, one
// incident has become two lines that disagree and this row goes red first.
// `./wire-bounds.test.ts`'s `WIRE-L8` asserts the same partition from the other side,
// naming which line this must be.
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

/** A real credential over a store that cannot answer. The "the database is not
 * answering" composition, with everything else about the request ordinary. */
function brokenReadDeps(): McpServerDeps {
  return { credentials: CREDENTIALS, reads: throwingReadPort() };
}

// WIRE-B1, detail-free, and logged

describe("WIRE-B1 — a read that throws becomes a detail-free answer with the fault logged", () => {
  test("answers with the unavailable sentence, carries no stack frame or file path, and logs once", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
        brokenReadDeps(),
      );
      const body = await response.text();

      // The precondition. Everything after this line is an absence, and an absence
      // asserted about a response the broken read never produced is worth nothing.
      expect(body).toContain(UNAVAILABLE.message);

      // The agent gets a sentence. The detail goes to the log, which is ours.
      expect(carriesStackFrame(body)).toBe(false);
      expect(carriesFilePath(body)).toBe(false);
      expect(body).not.toContain("mcp fixture");

      // Once, not never and not twice. Never means a real outage is invisible to us;
      // twice means two catches are both claiming the same fault, which is the shape
      // that makes a log unreadable during an incident.
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  // Non-vacuity for the two leak scanners: the thrown error's own text is exactly what
  // a leak would look like, and both scanners must see it.
  test("the leak scanners do fire on the fixture's own error text and a stack frame", () => {
    const leaky =
      "Error: mcp fixture: the read port is unreachable\n    at listOpenFixes (apps/web/lib/mcp/call-tool.ts:70:11)";

    expect(carriesStackFrame(leaky)).toBe(true);
    expect(carriesFilePath(leaky)).toBe(true);
    expect(carriesStackFrame(UNAVAILABLE.message)).toBe(false);
    expect(carriesFilePath(UNAVAILABLE.message)).toBe(false);
  });
});

// WIRE-B2, nothing escapes

describe("WIRE-B2 — no unhandled rejection escapes the mounted handler", () => {
  /**
   * The failure this row names is not a wrong answer. It is NO answer, plus a
   * process-level warning nobody reads. A rejection that escapes a request-scoped
   * handler in a serverless runtime can take the whole invocation down, and the caller
   * sees a socket close rather than a refusal.
   *
   * The watcher flushes a macrotask before reading its list, because the runtime
   * reports an unhandled rejection after the microtask queue drains. A watcher that
   * read immediately would report "clean" every time.
   */
  test("a rejecting port still comes back as a Response, with nothing left unhandled", async () => {
    const watched = await watchForUnhandledRejections(async () =>
      handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "fix-anything" }, key: KEY_A }),
        brokenReadDeps(),
      ),
    );

    expect(watched.result).toBeInstanceOf(Response);

    // The precondition again: the read really did run and really did throw, so there
    // was something that could have escaped.
    expect(await watched.result.text()).toContain(UNAVAILABLE.message);

    expect(watched.unhandled).toEqual([]);
  });
});
