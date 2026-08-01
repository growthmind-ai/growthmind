// THE READ-ONLY MACHINE SURFACE'S TRANSPORT BOUNDARY (O-009, O-013).
//
// A plain function over `Request` with its two effects injected, so the whole
// surface is driven end to end through its REAL entry point in tests, with
// fakes — the D11 discipline `worker/src/tasks/delivery-tick.ts` follows for
// the same reason. `../../app/api/mcp/route.ts` is the only queue of one line
// that knows about Next.js and about which implementations are wired in.
//
// THIS FILE DECIDES SIX THINGS AND THEN STOPS. Who is asking, whether a browser
// is asking, whether the body claims to be JSON, whether the verb is one this
// surface answers, whether the body is small enough to read, and whether it is
// one message rather than a batch of them. Everything past that — negotiation,
// the message envelope, framing, error codes, the shape a result travels in —
// belongs to `./wire.ts`, and every decision a tool call makes belongs to
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
//   5. THE SIZE GATE, ON BYTES AND NEVER ON A HEADER. The body is read here,
//      once, through a reader that STOPS at `MAX_BODY_BYTES` and cancels the
//      rest — so an over-size body is refused 413 having been bounded rather
//      than buffered. `content-length` is not consulted: it is absent on a
//      chunked request and a caller writes it, which makes it a claim rather
//      than a measurement.
//
//   6. THE BATCH GATE, ON THE FIRST NON-WHITESPACE BYTE. A body that opens with
//      `[` is a JSON-RPC BATCH and is refused 400 with `MALFORMED_BODY`, whose
//      first instruction is already "send a single JSON-RPC message". The
//      revision this surface negotiates removed batching, no client it targets
//      sends one, and `tools/list` and `tools/call` are single messages — so
//      the truthful answer is to refuse rather than to cap. Left open, one POST
//      bought 500 tool calls off one read-only credential: MEASURED, 500 reads
//      and 500 frames from one request, which against a real repository is 500
//      database round-trips.
//
//      ⚠️ THIS IS A SHAPE DECISION, NOT A PARSE. One byte is looked at, and no
//      value is ever read out of the body here — see the section below, whose
//      claim survives this gate intact.
//
//   7. HAND OFF, ONCE. `./wire.ts` receives the request and an ALREADY-RESOLVED
//      credential. It never authenticates, and it never sees a verb this file
//      would have refused. The request it receives is REBUILT from the bytes
//      read above, because a body can only be read once and the transport must
//      read it too — same url, same method, same headers, the same bytes.
//
// WE AUTHOR NO `Accept` GATE. The transport already requires both media types
// on the leg a stock client negotiates and refuses instructively when they are
// missing; a second, hand-rolled content-negotiation classifier of ours would
// be the same shape D-12 declined for the protocol-version header. What matters
// is that its refusal sits BEHIND the credential check, which the ordering
// above guarantees.
//
// ---------------------------------------------------------------------------
// THE ORGANIZATION COMES FROM THE CREDENTIAL, AND NOTHING HERE READS A VALUE
// OUT OF A BODY
// ---------------------------------------------------------------------------
//
// `McpCredential` is the only place an organization id exists in this file. The
// body is now READ — gates 5 and 6 above cannot be enforced without the bytes —
// but it is never PARSED: what those gates look at is a byte count and one
// non-whitespace character, and there is no `JSON.parse` in this file and no
// line below where a request value could be substituted for the credential's
// organization. The read port travels through untouched to `./call-tool.ts`,
// which takes the credential as its own parameter for the same structural
// reason.
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
  BODY_TOO_LARGE,
  BROWSER_ORIGIN,
  MALFORMED_BODY,
  UNAUTHENTICATED,
  UNAVAILABLE,
  WRONG_CONTENT_TYPE,
  WRONG_METHOD,
  refusalResponse,
  type McpRefusal,
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
 * The most this surface will ever read off one request.
 *
 * A MEGABYTE IS ABOUT FOUR ORDERS OF MAGNITUDE OF HEADROOM, and that is the
 * point of the number rather than a hedge. The largest message any of the three
 * tools can legitimately carry is a method name and one id bounded to 128
 * characters by its own schema; the handshake is smaller still. So a request
 * that does not fit here is not a big legitimate request — it is somebody
 * finding out what a read-only key buys them.
 *
 * WRITTEN ONCE, HERE. `BODY_TOO_LARGE` says "under a megabyte" in words, so a
 * change to this number is a change to that sentence and the two must move
 * together.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/** JSON's four whitespace bytes — space, tab, line feed, carriage return — and
 * the byte an array opens with. Named because a magic `0x5b` in a gate is the
 * stringly-typed failure the vocabulary file exists to remove. */
const JSON_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const JSON_ARRAY_OPEN = 0x5b;

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

  // ⚠️ THE BODY IS READ INSIDE THE CATCH, NOT IN FRONT OF IT. A request whose
  // stream errors mid-flight — a client that hung up, a proxy that gave up —
  // rejects out of `readBoundedBody`, and read ahead of the `try` that would be
  // an exception escaping this function with no answer framed at all. Inside,
  // it is one detail-free `UNAVAILABLE` like every other fault this file owns.
  try {
    const body = await readBoundedBody(request);
    if (!body.ok) {
      return refusalResponse(body.refusal);
    }

    // ONE BYTE, AND NOT A PARSE. An array is a JSON-RPC batch; this surface
    // answers single messages and the revision it negotiates removed batching.
    if (opensAnArray(body.bytes)) {
      return refusalResponse(MALFORMED_BODY);
    }

    return await renderMcpWire(replayable(request, body.bytes), {
      reads: deps.reads,
      credential,
    });
  } catch (error) {
    // THE OUTER CATCH, AND IT HAS A DIFFERENT JOB FROM `callTool`'s. That one
    // owns a fault INSIDE a tool call — a read that broke, a spec that would
    // not render, an output that would not parse — and turns it into a refusal
    // value without ever throwing. This one owns a fault in reading the body or
    // in the wire layer itself, which is the only way an exception can still
    // arrive here.
    //
    // ⚠️ THE THREE CHANNELS PARTITION, AND NO TWO CAN FIRE FOR ONE EVENT. The
    // third is `wire.ts`'s `onerror`, which owns faults INSIDE the transport —
    // returned rather than thrown, so unreachable from here.
    // `__tests__/mcp/failure-isolation.test.ts` requires EXACTLY ONE log line
    // for a broken read and `__tests__/mcp/wire-bounds.test.ts` names which one
    // it must be. Do not add a fourth catch around the tool core, and do not
    // log a tool fault twice on its way out.
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

/** The body, or the reason it was not read. A union rather than a throw,
 * because "too big" is an answer this surface gives rather than a fault it
 * has. */
type BoundedBody =
  /** `Uint8Array<ArrayBuffer>` rather than the default `<ArrayBufferLike>`: a
   * view over a possibly-shared buffer is not a `BodyInit`, so the narrower
   * type is what lets the bytes be handed straight back to a `Request` without
   * a copy or a cast. */
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly refusal: McpRefusal };

/**
 * Every byte of the body, or a refusal — reading no more than the ceiling.
 *
 * ⚠️ CHUNK BY CHUNK, AND STOPPING IS THE WHOLE POINT. `await request.text()`
 * and `await request.json()` both buffer the entire body BEFORE anything can
 * look at its size, which is how a 20 MB request turned into about 89 MB of
 * heap on a surface whose largest legitimate message is a few hundred bytes.
 * Reading through the reader lets the running total be checked after each
 * chunk, so the peak this function can reach is the ceiling plus one chunk —
 * bounded, rather than whatever a caller decided to send.
 *
 * `cancel()` rather than a bare `return`: the rest of the stream is discarded
 * explicitly, so the sender is not left writing into something nobody is
 * reading.
 *
 * BYTES, NEVER TEXT. Decoding to a string and re-encoding would round-trip
 * invalid UTF-8 through replacement characters and hand the transport different
 * bytes from the ones that arrived — which would make its own parse error a
 * report about our copy rather than about the request.
 */
async function readBoundedBody(request: Request): Promise<BoundedBody> {
  const stream = request.body;
  if (stream === null) {
    return { ok: true, bytes: new Uint8Array(0) };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      // SEQUENTIAL BY NECESSITY, not by oversight: a stream has no next chunk
      // to ask for until the current one has arrived, and the whole point of
      // reading it this way is to stop between chunks. `Promise.all` has
      // nothing to parallelise here.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }

      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        return { ok: false, refusal: BODY_TOO_LARGE };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Does this body open a JSON array?
 *
 * THE FIRST NON-WHITESPACE BYTE DECIDES, which is a fact about JSON rather than
 * a heuristic: a document's first non-whitespace character is its root value's
 * opening token, and `[` is the only one an array can start with. So this
 * answers "is this a batch" without parsing anything, without allocating a
 * string, and without a second envelope reader existing anywhere in this
 * codebase — which is precisely the drift the transport was adopted to remove.
 *
 * An empty body opens nothing and is not an array; the transport answers it
 * with its own parse error, exactly as before.
 */
function opensAnArray(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (JSON_WHITESPACE.has(byte)) {
      continue;
    }
    return byte === JSON_ARRAY_OPEN;
  }
  return false;
}

/**
 * The same request, with its body readable again.
 *
 * A BODY CAN ONLY BE READ ONCE, and the gates above have read it — so the
 * transport, which must read it too, is handed a request rebuilt from the very
 * bytes those gates measured. Same url, same method, same headers, same bytes:
 * there is no transformation here for anything to be lost in, and no place for
 * the request the gates judged and the request the transport serves to differ.
 *
 * An empty body is passed as `null` rather than as a zero-length buffer, so a
 * bodiless POST reaches the transport as the bodiless POST it was.
 */
function replayable(request: Request, bytes: Uint8Array<ArrayBuffer>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes.byteLength === 0 ? null : bytes,
  });
}
