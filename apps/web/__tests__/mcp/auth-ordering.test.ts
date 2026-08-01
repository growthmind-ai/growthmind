// THE ORDER OF THE GATES, PROVED BY ASYMMETRY — WIRE-O1 / WIRE-O2 (O-013,
// lane W0-T-A, D-6 rule 1).
//
// `server.ts`'s header opens with the sentence this file exists to hold to:
// AUTHENTICATE FIRST, before the body is read, before the tool name is
// resolved, before anything is parsed. An anonymous caller may learn exactly
// one thing — that it is anonymous — and everything else it could learn is a
// probe: which tool names exist, which arguments are valid, whether a payload
// was well formed.
//
// Moving onto a wire protocol is the moment that ordering is most likely to
// break, and to break invisibly. The transport parses bodies, negotiates
// content types and frames errors, and every one of those steps is an answer a
// caller can read. If any of them runs before our credential check, the surface
// has grown an unauthenticated oracle without anyone editing an auth line.
//
// ---------------------------------------------------------------------------
// WHY TWO ROWS AND NOT ONE — THE DEAD-HANDLE ASYMMETRY
// ---------------------------------------------------------------------------
//
// "An unauthenticated request with a broken body returns 401" is a sentence
// that stays true if authentication runs SECOND, as long as the parser also
// refuses. The row would pass while proving nothing about order.
//
// So the claim is made by DIFFERENCE. One body, sent twice, differing only in
// whether a credential rode with it:
//
//   - with no credential  → the 401 frame, byte for byte;
//   - with a credential   → a PARSE ERROR, which is a different answer entirely.
//
// The second half is what makes the first mean something: the body really is
// un-parseable, the parser really does have something to say about it, and the
// anonymous caller did not hear it. This is the pattern the mcp-read-credential
// retro named — an assertion that a handle is dead is worth nothing without its
// twin proving the handle was live.
//
// ---------------------------------------------------------------------------
// BANDS, AND WHY WIRE-O1 IS GREEN ON ARRIVAL
// ---------------------------------------------------------------------------
//
// `WIRE-O1` sits in the PRE-SDK 401 BAND: `{ 401, "application/json;charset=utf-8",
// '{"ok":false,"error":{…}}' }`, produced by `refusalResponse` before the
// transport is anywhere in the call stack. It is byte-identical to `origin/main`,
// measured era-identical, and immune to both `responseMode` and the transport's
// own `Accept` 406. So it passes today and its job is to KEEP passing through
// waves 7–8 — the one row in this lane whose value is that nothing about it
// moves. Note the `;charset=utf-8` suffix: it is the measured header value, and
// an equality against a bare `application/json` fails.
//
// `WIRE-O2` is red until wave 8, because the route does not speak JSON-RPC yet
// and answers the same body with our pre-protocol `MALFORMED_BODY` rather than
// with a parse error the transport framed.
import { describe, expect, test } from "bun:test";

import { UNAUTHENTICATED } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import { JSON_RPC_ERROR_CODE } from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rawBodyRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
} from "./helpers/mcp-fixture";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: { credentials: CREDENTIALS, reads: spy.port } };
}

/**
 * ONE BODY, USED BY BOTH ROWS, DECLARED ONCE.
 *
 * It is JSON-RPC-shaped right up to the point where it stops being JSON at all,
 * so a parser has to start reading it before it can refuse it — which is
 * precisely the work an anonymous caller must not be able to make this server
 * do. Two copies of this string would be two chances for the halves to drift
 * apart and the asymmetry to stop being about one input.
 */
const UNPARSEABLE_BODY = '{"jsonrpc":"2.0","id":1,"method":';

/** The measured pre-SDK content type — `Response.json`'s own, with the charset
 * suffix that a bare `application/json` equality would miss. */
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

/**
 * The 401 frame, rebuilt from the refusal constant rather than pasted as a
 * literal.
 *
 * `refusalResponse` writes `{ ok, error: { code, message } }` in that key order
 * and adds nothing, so this is the exact byte sequence — and building it from
 * `UNAUTHENTICATED` means a reworded sentence fails here with the old text
 * visible in the diff, instead of a hard-coded string quietly outliving the
 * constant it was copied from.
 */
const UNAUTHENTICATED_FRAME = JSON.stringify({
  ok: false,
  error: { code: UNAUTHENTICATED.code, message: UNAUTHENTICATED.message },
});

// ---------------------------------------------------------------------------
// WIRE-O1 — the anonymous half
// ---------------------------------------------------------------------------

describe("WIRE-O1 — an unauthenticated request whose body would crash the parser is refused cleanly before parsing", () => {
  test("answers the 401 frame byte for byte and asks the port nothing", async () => {
    const { spy, deps } = spyDeps();

    const response = await handleMcpRequest(rawBodyRequest(UNPARSEABLE_BODY, null), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(401);
    expect(print.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(print.body).toBe(UNAUTHENTICATED_FRAME);

    // Nothing that touches data ran. The body was never parsed, so no tool name
    // was ever resolved to run it with.
    expect(spy.organizationsAsked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WIRE-O2 — the authenticated twin
// ---------------------------------------------------------------------------

describe("WIRE-O2 — the authenticated twin of the same body fails at the parser, proving the refusal was the auth gate", () => {
  test("answers the identical body with a parse error rather than the 401 frame", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rawBodyRequest(UNPARSEABLE_BODY, KEY_A), deps);
    const print = await fingerprint(response);

    // THE POSITIVE HALF FIRST. Everything below is an absence, and an absence
    // asserted about the wrong response proves nothing — so establish that this
    // is the parser's answer before claiming it is not the auth gate's.
    expect(print.body).toContain(`"code":${JSON_RPC_ERROR_CODE.PARSE_ERROR}`);

    expect(print.status).not.toBe(401);
    expect(print.body).not.toBe(UNAUTHENTICATED_FRAME);
    expect(print.body).not.toContain(UNAUTHENTICATED.message);
  });

  /**
   * The asymmetry itself, stated as one comparison over the whole answer.
   *
   * Two fingerprints of one body under two credentials. If these ever become
   * equal, the surface has stopped distinguishing "I do not know who you are"
   * from "I could not read what you sent" — which means one of the two gates
   * stopped running, and no single-response assertion above would say so.
   */
  test("the two answers to one body differ, so the credential is what decided which came back", async () => {
    const anonymous = await fingerprint(
      await handleMcpRequest(rawBodyRequest(UNPARSEABLE_BODY, null), spyDeps().deps),
    );
    const authenticated = await fingerprint(
      await handleMcpRequest(rawBodyRequest(UNPARSEABLE_BODY, KEY_A), spyDeps().deps),
    );

    expect(anonymous.body).toBe(UNAUTHENTICATED_FRAME);
    expect(authenticated).not.toEqual(anonymous);
  });
});
