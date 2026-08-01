// THE READ-ONLY MACHINE SURFACE'S TRANSPORT BOUNDARY (O-009, O-013).
//
// A plain function over `Request` with its two effects injected, so the whole
// surface is driven end to end through its REAL entry point in tests, with
// fakes — the D11 discipline `worker/src/tasks/delivery-tick.ts` follows for
// the same reason. `../../app/api/mcp/route.ts` is the only queue of one line
// that knows about Next.js and about which implementations are wired in.
//
// THIS FILE DECIDES FOUR THINGS AND THEN STOPS. Who is asking, whether a
// browser is asking, whether the body claims to be JSON, and whether the verb
// is one this surface answers. Everything past that — negotiation, the message
// envelope, framing, error codes, the shape a result travels in — belongs to
// `./wire.ts`, and every decision a tool call makes belongs to
// `./call-tool.ts`. Neither of those is nameable from here except by its one
// exported function, which is what makes the seam a fact rather than a habit.
//
// ---------------------------------------------------------------------------
// THE ORDER OF OPERATIONS IS PART OF THE SECURITY ARGUMENT
// ---------------------------------------------------------------------------
//
//   1. AUTHENTICATE FIRST, before the body is read, before any header gate
//      fires, before the wire layer is constructed at all. An unauthenticated
//      caller must not be able to learn which tool names exist, which arguments
//      are valid, whether a payload was well formed, or even which media types
//      this surface accepts — every one of those is a probe, and the answers
//      differ. So there is exactly one thing an anonymous caller can find out:
//      that it is not authenticated.
//
//      THIS IS WHY THE 401 IS PRE-WIRE, AND IT IS LOAD-BEARING. The refusal is
//      produced before the transport is anywhere in the call stack, so all six
//      unauthenticated cases are byte-identical BY CONSTRUCTION rather than by
//      review, and the transport's own content-negotiation refusal can never
//      come back to a caller that presented no key.
//
//   2. THE ORIGIN GATE. A request carrying an `Origin` header AT ALL is refused
//      403; a request carrying none FAILS OPEN and is served. That direction is
//      the decision, not an oversight: an MCP client is not a browser and sends
//      no `Origin`, so failing closed on its absence would refuse every real
//      client and break `docker compose up` on every hostname — an exclusion
//      predicate firing on a superset of its real target. Failing open costs
//      nothing here because this surface carries no ambient credential: it is
//      bearer-only and cookie-blind, so a page cannot forge an authenticated
//      call even when it reaches us. The 403 closes the DNS-rebinding shape; it
//      is not an authentication control.
//
//   3. THE CONTENT-TYPE GATE, ON WHAT A REQUEST DECLARES. A body announced as
//      anything other than JSON is refused 415 with the sentence that says what
//      to send. A request that declares NOTHING is not refused here — a
//      bodiless verb has no content type to be wrong about, and the speculative
//      `GET` a real client opens during its handshake is exactly that request.
//      It falls through to the verb gate below and is answered 405, which is
//      what a correct handshake expects.
//
//   4. THE VERB GATE. `POST` and nothing else. Every other method is 405 with a
//      sentence telling an agent what to send instead — never a bodiless 405
//      from a framework, and never delegated to the transport, which would
//      answer without instructions. The catalogue is no longer a `GET`: it
//      moved onto the wire protocol as `tools/list`, so a `GET` has nothing
//      left to answer with.
//
//   5. HAND OFF, ONCE. `./wire.ts` receives the request and an ALREADY-RESOLVED
//      credential. It never authenticates, and it never sees a verb this file
//      would have refused.
//
// WE AUTHOR NO `Accept` GATE. The transport already requires both media types
// on the leg a stock client negotiates and refuses instructively when they are
// missing; a second, hand-rolled content-negotiation classifier of ours would
// be the same shape D-12 declined for the protocol-version header. What matters
// is that its refusal sits BEHIND the credential check, which the ordering
// above guarantees.
//
// ---------------------------------------------------------------------------
// THE ORGANIZATION COMES FROM THE CREDENTIAL, AND NOTHING HERE READS A BODY
// ---------------------------------------------------------------------------
//
// `McpCredential` is the only place an organization id exists in this file, and
// this file no longer parses a body at all — so there is not a line below where
// a request value could be substituted for it. The read port travels through
// untouched to `./call-tool.ts`, which takes the credential as its own
// parameter for the same structural reason.
//
// ---------------------------------------------------------------------------
// THE ZOD POSITION THIS FILE USED TO ARGUE IS RETIRED, ON A MEASUREMENT
// ---------------------------------------------------------------------------
//
// Two long comment blocks here used to argue that `apps/web` must never depend
// on `zod`, because a second copy on disk would break `instanceof` against the
// schemas `packages/shared` builds. THE HAZARD REQUIRES TWO COPIES, AND WAVE 0
// MEASURED EXACTLY ONE (`4.4.3`, hoisted) after the transport package was
// installed — and `zod` is not resolvable from `apps/web` at all under bun's
// isolated linker, at runtime or under typecheck. So the invariant is enforced
// by the INSTALLER rather than by an argument, and the argument is withdrawn.
//
// THIS MATTERS DOWNSTREAM, WHICH IS WHY IT IS STATED RATHER THAN DELETED. The
// retired position said "no schema object may cross into the wire layer". Taken
// as binding it would break tool registration outright: registration REQUIRES a
// standard schema and refuses a pre-rendered JSON Schema document. The shared
// Zod objects are handed across verbatim, on purpose, so the object that
// validates a call is the object that renders what a caller was shown.
// `__tests__/mcp/no-direct-zod.test.ts` holds both halves.
import type { McpCredential, McpCredentialSource } from "./credentials";
import { presentedCredential } from "./credentials";
import type { McpReadPort } from "./read-port";
import {
  BROWSER_ORIGIN,
  UNAUTHENTICATED,
  UNAVAILABLE,
  WRONG_CONTENT_TYPE,
  WRONG_METHOD,
  refusalResponse,
} from "./refusals";
import { renderMcpWire } from "./wire";
import { MCP_HEADER } from "./wire-constants";

/** The two things this handler cannot construct for itself: who is asking, and
 * where the answers come from. Both are ports; neither names a table. */
export interface McpServerDeps {
  readonly credentials: McpCredentialSource;
  readonly reads: McpReadPort;
}

/** The one verb this surface answers, and the one media type a body may
 * announce. Neither is a protocol vocabulary word — the header names, the
 * protocol revisions and the error codes all live in `./wire-constants.ts`, and
 * a test fails this file if any of them is written inline here. */
const SERVED_METHOD = "POST";
const JSON_MEDIA_TYPE = "application/json";

/**
 * The boundary, in one function.
 *
 * Its signature is fixed: a raw request in, a response out, with both effects
 * injected. Every suite in `__tests__/mcp/` drives this, so it is the narrowest
 * place the whole surface can be proven from — and the place the gate ordering
 * above is actually enforced rather than described.
 */
export async function handleMcpRequest(request: Request, deps: McpServerDeps): Promise<Response> {
  const credential = await authenticate(request, deps.credentials);
  if (credential === null) {
    return refusalResponse(UNAUTHENTICATED);
  }

  // PRESENCE IS THE WHOLE RULE. No allow-list, no configuration, and no
  // inspection of the value — see the fail direction declared in the header.
  if (request.headers.get(MCP_HEADER.ORIGIN) !== null) {
    return refusalResponse(BROWSER_ORIGIN);
  }

  if (declaresSomethingOtherThanJson(request)) {
    return refusalResponse(WRONG_CONTENT_TYPE);
  }

  if (request.method !== SERVED_METHOD) {
    return refusalResponse(WRONG_METHOD);
  }

  try {
    return await renderMcpWire(request, { reads: deps.reads, credential });
  } catch (error) {
    // THE OUTER CATCH, AND IT HAS A DIFFERENT JOB FROM `callTool`'s. That one
    // owns a fault INSIDE a tool call — a read that broke, a spec that would
    // not render, an output that would not parse — and turns it into a refusal
    // value without ever throwing. This one owns a fault in the wire layer
    // itself, which is the only way an exception can still arrive here.
    //
    // ⚠️ THE TWO CAN NEVER BOTH FIRE FOR ONE EVENT, and that is asserted:
    // `__tests__/mcp/failure-isolation.test.ts` requires EXACTLY ONE log line
    // for a broken read. Do not add a third catch around the tool core, and do
    // not log a tool fault twice on its way out.
    console.error("mcp: the wire could not answer a request", error);
    return refusalResponse(UNAVAILABLE);
  }
}

/**
 * Who is asking, or nobody.
 *
 * FAIL CLOSED ON EVERY PATH, including a credential store that throws. A
 * database outage becoming "not authenticated" rather than "service
 * unavailable" is deliberate: an authentication path that degrades open is not
 * an authentication path, and the difference is visible in the log where it
 * belongs rather than on the wire where it is an oracle.
 */
async function authenticate(
  request: Request,
  credentials: McpCredentialSource,
): Promise<McpCredential | null> {
  const presented = presentedCredential(request);
  if (presented === null) {
    return null;
  }

  try {
    return await credentials.resolve(presented);
  } catch (error) {
    console.error("mcp: the presented key could not be checked, so it was refused", error);
    return null;
  }
}

/**
 * Did this request announce a body that is not JSON?
 *
 * ANNOUNCED, NOT ABSENT. A request with no content type at all is not refused
 * here — see gate 3 in the header. Only a declaration we cannot read is, and
 * the declaration is compared on its media type alone: `application/json` and
 * `application/json; charset=utf-8` are the same claim, and a gate that
 * rejected the second would refuse clients for punctuation.
 */
function declaresSomethingOtherThanJson(request: Request): boolean {
  const declared = request.headers.get(MCP_HEADER.CONTENT_TYPE);
  if (declared === null) {
    return false;
  }

  const mediaType = (declared.split(";")[0] ?? "").trim().toLowerCase();
  return mediaType !== JSON_MEDIA_TYPE;
}
