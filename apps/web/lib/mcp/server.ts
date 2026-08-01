// The read-only machine surface's transport boundary: a plain function over `Request`
// with its two effects injected, so the whole surface is tested through its real entry
// point. Authentication runs first, before the body is read or the wire layer exists.
// The Origin gate refuses a request carrying that header and fails open on its absence,
// because an MCP client is not a browser; this surface is bearer-only and cookie-blind.
// Design rationale: docs/decisions/0005-mcp-server-composition.md
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

/** The two things this handler cannot construct for itself: who is asking, and where
 * the answers come from. Both are ports; neither names a table. */
export interface McpServerDeps {
  readonly credentials: McpCredentialSource;
  readonly reads: McpReadPort;
}

/** The one verb this surface answers, and the one media type a body may announce.
 * Neither is a protocol vocabulary word. The header names, the protocol revisions and
 * the error codes all live in `./wire-constants.ts`, and a test fails this file if any
 * of them is written inline here. */
const SERVED_METHOD = "POST";
const JSON_MEDIA_TYPE = "application/json";

/**
 * The most this surface will ever read off one request.
 *
 * A megabyte is about four orders of magnitude of headroom, and that is the point of
 * the number rather than a hedge. The largest message any of the three tools can
 * legitimately carry is a method name and one id bounded to 128 characters by its own
 * schema; the handshake is smaller still. So a request that does not fit here is not a
 * big legitimate request. It is somebody finding out what a read-only key buys them.
 *
 * Written once, here. `BODY_TOO_LARGE` says "under a megabyte" in words, so a change to
 * this number is a change to that sentence and the two must move together.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/** Json's four whitespace bytes (space, tab, line feed, carriage return) and the byte
 * an array opens with. Named because a magic `0x5b` in a gate is the stringly-typed
 * failure the vocabulary file exists to remove. */
const JSON_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const JSON_ARRAY_OPEN = 0x5b;

/**
 * The boundary, in one function.
 *
 * Its signature is fixed: a raw request in, a response out, with both effects injected.
 * Every suite in `__tests__/mcp/` drives this, so it is the narrowest place the whole
 * surface can be proven from, and the place the gate ordering argued in
 * docs/decisions/0005-mcp-server-composition.md is actually enforced rather than
 * described.
 */
export async function handleMcpRequest(request: Request, deps: McpServerDeps): Promise<Response> {
  const credential = await authenticate(request, deps.credentials);
  if (credential === null) {
    return refusalResponse(UNAUTHENTICATED);
  }

  // Presence is the whole rule. No allow-list, no configuration, and no inspection of
  // the value. See the fail direction declared in the header.
  if (request.headers.get(MCP_HEADER.ORIGIN) !== null) {
    return refusalResponse(BROWSER_ORIGIN);
  }

  if (declaresSomethingOtherThanJson(request)) {
    return refusalResponse(WRONG_CONTENT_TYPE);
  }

  if (request.method !== SERVED_METHOD) {
    return refusalResponse(WRONG_METHOD);
  }

  // The body is read inside the catch, not in front of it. A request whose stream
  // errors mid-flight (a client that hung up, a proxy that gave up) rejects out of
  // `readBoundedBody`, and read ahead of the `try` that would be an exception escaping
  // this function with no answer framed at all. Inside, it is one detail-free
  // `UNAVAILABLE` like every other fault this file owns.
  try {
    const body = await readBoundedBody(request);
    if (!body.ok) {
      return refusalResponse(body.refusal);
    }

    // One byte, and not a parse. An array is a JSON-RPC batch; this surface answers
    // single messages and the revision it negotiates removed batching.
    if (opensAnArray(body.bytes)) {
      return refusalResponse(MALFORMED_BODY);
    }

    return await renderMcpWire(replayable(request, body.bytes), {
      reads: deps.reads,
      credential,
    });
  } catch (error) {
    // The outer catch, and it has a different job from `callTool`'s. That one owns a
    // fault inside a tool call. A read that broke, a spec that would not render, an
    // output that would not parse, and turns it into a refusal value without ever
    // throwing. This one owns a fault in reading the body or in the wire layer itself,
    // which is the only way an exception can still arrive here.
    //
    // The three channels partition, and no two can fire for one event. The third is
    // `wire.ts`'s `onerror`, which owns faults inside the transport. Returned rather
    // than thrown, so unreachable from here. `__tests__/mcp/failure-isolation.test.ts`
    // requires exactly one log line for a broken read and
    // `__tests__/mcp/wire-bounds.test.ts` names which one it must be. Do not add a
    // fourth catch around the tool core, and do not log a tool fault twice on its way
    // out.
    console.error("mcp: the wire could not answer a request", error);
    return refusalResponse(UNAVAILABLE);
  }
}

/**
 * Who is asking, or nobody.
 *
 * Fail closed on every path, including a credential store that throws. A database
 * outage becoming "not authenticated" rather than "service unavailable" is deliberate:
 * an authentication path that degrades open is not an authentication path, and the
 * difference is visible in the log where it belongs rather than on the wire where it is
 * an oracle.
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
 * Announced, not absent. A request with no content type at all is not refused here (see
 * the content-type gate in docs/decisions/0005-mcp-server-composition.md). Only a
 * declaration we cannot read is, and the declaration is compared on its media type
 * alone: `application/json` and `application/json;
 * charset=utf-8` are the same claim, and a gate that rejected the second would refuse
 * clients for punctuation.
 */
function declaresSomethingOtherThanJson(request: Request): boolean {
  const declared = request.headers.get(MCP_HEADER.CONTENT_TYPE);
  if (declared === null) {
    return false;
  }

  const mediaType = (declared.split(";")[0] ?? "").trim().toLowerCase();
  return mediaType !== JSON_MEDIA_TYPE;
}

/** The body, or the reason it was not read. A union rather than a throw, because "too
 * big" is an answer this surface gives rather than a fault it has. */
type BoundedBody =
  /** `Uint8Array<ArrayBuffer>` rather than the default `<ArrayBufferLike>`: a view over
   * a possibly-shared buffer is not a `BodyInit`, so the narrower type is what lets the
   * bytes be handed straight back to a `Request` without a copy or a cast. */
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly refusal: McpRefusal };

/**
 * Every byte of the body, or a refusal. Reading no more than the ceiling.
 *
 * Chunk by chunk, and stopping is the whole point. `await request.text` and `await
 * request.json` both buffer the entire body before anything can look at its size,
 * which is how a 20 MB request turned into about 89 MB of heap on a surface whose
 * largest legitimate message is a few hundred bytes. Reading through the reader lets
 * the running total be checked after each chunk, so the peak this function can reach is
 * the ceiling plus one chunk. Bounded, rather than whatever a caller decided to send.
 *
 * `cancel` rather than a bare `return`: the rest of the stream is discarded
 * explicitly, so the sender is not left writing into something nobody is reading.
 *
 * Bytes, never text. Decoding to a string and re-encoding would round-trip invalid
 * UTF-8 through replacement characters and hand the transport different bytes from the
 * ones that arrived, which would make its own parse error a report about our copy
 * rather than about the request.
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
      // Sequential by necessity, not by oversight: a stream has no next chunk to ask
      // for until the current one has arrived, and the whole point of reading it this
      // way is to stop between chunks. `Promise.all` has nothing to parallelise here.
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
 * The first non-whitespace byte decides, which is a fact about JSON rather than a
 * heuristic: a document's first non-whitespace character is its root value's opening
 * token, and `[` is the only one an array can start with. So this answers "is this a
 * batch" without parsing anything, without allocating a string, and without a second
 * envelope reader existing anywhere in this codebase, which is precisely the drift the
 * transport was adopted to remove.
 *
 * An empty body opens nothing and is not an array; the transport answers it with its
 * own parse error, exactly as before.
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
 * A body can only be read once, and the gates above have read it, so the transport,
 * which must read it too, is handed a request rebuilt from the very bytes those gates
 * measured. Same url, same method, same headers, same bytes: there is no transformation
 * here for anything to be lost in, and no place for the request the gates judged and
 * the request the transport serves to differ.
 *
 * An empty body is passed as `null` rather than as a zero-length buffer, so a bodiless
 * POST reaches the transport as the bodiless POST it was.
 */
function replayable(request: Request, bytes: Uint8Array<ArrayBuffer>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes.byteLength === 0 ? null : bytes,
  });
}
