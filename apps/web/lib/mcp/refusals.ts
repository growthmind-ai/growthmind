// WHAT THIS SURFACE SAYS WHEN IT WILL NOT ANSWER (O-009).
//
// ---------------------------------------------------------------------------
// THE ONE RULE THIS FILE EXISTS TO MAKE STRUCTURAL
// ---------------------------------------------------------------------------
//
// `packages/shared/src/mcp/types.ts` closed everything a schema can close: no
// tool input names an organization. It then handed forward the one obligation
// a schema cannot discharge, and this file is half of the discharge:
//
//   > an id belonging to ANOTHER organization must answer IDENTICALLY to one
//   > that does not exist. A distinguishable "not yours" is itself a
//   > cross-tenant read.
//
// A refusal that varies — a different message, a different status, an echoed
// id, a longer body — is an oracle. Point it at a guessed id and it answers
// "that exists, somewhere else", which is the fact the tenant boundary exists
// to withhold. Timing is the same oracle one layer down, which is why the read
// port resolves org and id in ONE query and this file has no branch that could
// run only on one of the two paths.
//
// So the refusals below are CONSTANTS, not templates:
//
//   - `NOT_FOUND` is one frozen value, returned for a missing id, a foreign
//     org's id, and a foreign org's project id alike. It names no id, no tool,
//     and no organization — there is nothing in it that could differ between
//     the two cases, because there is nothing in it that comes from the
//     request at all.
//
//   - `UNAUTHENTICATED` is one frozen value, returned for a missing key, a
//     malformed key, an unknown key, a revoked key, a key of the wrong kind,
//     and a credential store that could not be reached. "Your key is revoked"
//     and "your key is the wrong kind" are both useful sentences and both
//     confirm that the presented string is a real key of ours, which is
//     precisely what an attacker holding a scraped string wants to know.
//
// `__tests__/mcp/cross-tenant.test.ts` compares the two responses byte for
// byte — status, body text, and content type — rather than trusting that they
// were built from the same constant.
//
// ---------------------------------------------------------------------------
// WHY THE MESSAGES READ THE WAY THEY DO
// ---------------------------------------------------------------------------
//
// The reader is a coding agent, and the draft contract's rule is that errors
// INSTRUCT rather than merely report — an agent told only "403" stops, while an
// agent told what to do next carries on. So every message says what happens
// now, in the words the agent's own user would use, with no product vocabulary
// (the audit in `__tests__/mcp/route.test.ts` scans them against
// `FORBIDDEN_PRODUCT_JARGON` — the one list, never a second one).
//
// The single exception to "instruct" is `NOT_FOUND` and `UNAUTHENTICATED`,
// where the instruction has to stay generic for the reason above.

/** The shapes of refusal this surface has. Every one of them is a read that
 * did not happen; none of them is a partial answer.
 *
 * LISTED IN THE ORDER THE GATES FIRE in `./server.ts` — authenticate, then
 * Origin, then Content-Type, then method, then the body's size, then its shape
 * (a batch is refused as `malformed_request`), then the envelope, then the
 * tool, then the row, then our own fault. The order is not decoration: it is
 * the security argument in that file's header, and a reader who wants to know
 * what an anonymous caller can learn reads it top-down and stops at the first
 * line. */
export type McpRefusalCode =
  | "unauthenticated"
  | "browser_origin"
  | "wrong_content_type"
  | "wrong_method"
  | "body_too_large"
  | "malformed_request"
  | "unknown_tool"
  | "not_found"
  | "unavailable";

export interface McpRefusal {
  readonly code: McpRefusalCode;
  /** Plain English, addressed to the agent, saying what to do next. */
  readonly message: string;
  readonly status: number;
}

/**
 * Missing key, malformed key, unknown key, revoked key, wrong KIND of key, or a
 * credential store we could not reach — one answer for all six.
 *
 * The second sentence is the one piece of instruction that is safe to give,
 * because it is true of everybody and tells an attacker nothing: the keys a
 * website's own code carries are not the keys this surface reads. See
 * `./credentials.ts` for why those are different things.
 */
export const UNAUTHENTICATED: McpRefusal = Object.freeze({
  code: "unauthenticated",
  message:
    "This request did not arrive with a key this server reads, so nothing was looked at. " +
    "The key a website sends its activity with is not the same key a coding agent reads with — " +
    "ask whoever runs this product for one made for coding agents.",
  status: 401,
});

/**
 * The flagship constant. Returned for an id that does not exist and for an id
 * that belongs to somebody else, with nothing in it that could tell the two
 * apart.
 */
export const NOT_FOUND: McpRefusal = Object.freeze({
  code: "not_found",
  message:
    "There is nothing here with that id. Call list_open_fixes to see the ids you can ask about.",
  status: 404,
});

/**
 * Our fault, said plainly, with nothing behind it.
 *
 * NO ERROR TEXT AND NO STACK EVER REACHES THIS BODY. A thrown error carries
 * file paths, ids, and sometimes row contents; the log gets that (logs are
 * ours), the agent gets a sentence. It is a 500 rather than a 404 because
 * pretending a broken read is an empty one is how an agent concludes a real
 * problem does not exist.
 */
export const UNAVAILABLE: McpRefusal = Object.freeze({
  code: "unavailable",
  message:
    "Something went wrong on our side while putting that answer together, so nothing is coming " +
    "back rather than something wrong. Nothing you change will fix it; try again later.",
  status: 500,
});

/**
 * A caller that is a web page. Refused on the presence of an `Origin` header
 * alone, with no allow-list and no configuration (D-9).
 *
 * ABSENCE FAILS OPEN, AND THAT IS THE DECISION, NOT AN OVERSIGHT. An MCP client
 * is not a browser and sends no `Origin`; only a page running in one does, and
 * there is no legitimate browser caller of this surface. Failing closed on
 * absence would refuse every real client and break `docker compose up` on every
 * hostname — an exclusion predicate firing on a superset of its target. It
 * costs nothing to fail open here because this surface carries no ambient
 * credential: it is bearer-only and cookie-blind, so a page cannot forge an
 * authenticated request even when it reaches us. The 403 closes the
 * DNS-rebinding shape; it is not an authentication control, and `./server.ts`'s
 * header says so in words.
 */
export const BROWSER_ORIGIN: McpRefusal = Object.freeze({
  code: "browser_origin",
  message:
    "This server does not answer requests from a web page. Call it from a coding agent or " +
    "another program, with the key that agent was given.",
  status: 403,
});

/**
 * A body that did not arrive as JSON.
 *
 * SEPARATE FROM `MALFORMED_BODY` ON PURPOSE. "Your JSON is shaped wrong" and
 * "you did not send JSON" are different mistakes with different next actions,
 * and an agent told the wrong one edits the wrong thing. 415 rather than 400
 * for the same reason: the status already carries the distinction, so the
 * sentence does not have to argue for it.
 */
export const WRONG_CONTENT_TYPE: McpRefusal = Object.freeze({
  code: "wrong_content_type",
  message:
    "We could not read that request because it did not arrive as JSON. Send it with a content " +
    "type of application/json.",
  status: 415,
});

/**
 * Every other method. Doubles as the plainest statement of what this surface
 * is: it reads, and there is no verb here that does anything else.
 *
 * RE-AUTHORED (D-12). The previous sentence offered "a GET to see the tools
 * that exist", which this surface stopped being able to honour the moment the
 * catalogue moved onto the wire protocol: `tools/list` is a JSON-RPC method on
 * the POST, and `GET` is now only ever this refusal. An instruction that has
 * become false is worse than no instruction, because an agent follows it.
 */
export const WRONG_METHOD: McpRefusal = Object.freeze({
  code: "wrong_method",
  message:
    "This server only reads, and it only answers a POST carrying a single JSON-RPC message. " +
    "Send tools/list that way to see what it can do. Nothing here changes anything.",
  status: 405,
});

/**
 * A body bigger than anything this surface could ever have a use for.
 *
 * NEW THIS SPRINT, AND THE ONLY SENTENCE THE POST-SPRINT AUDIT ADDED. It exists
 * because nothing stood between the credential check and the transport, and a
 * read-only key is not a lever a caller should be able to buy arbitrary work
 * with: a 20 MB body was buffered whole — about 89 MB of heap — before any gate
 * downstream of authentication fired. `./server.ts` now stops reading at a
 * stated ceiling, and this is what it says when it does.
 *
 * SEPARATE FROM `MALFORMED_BODY` FOR THE SAME REASON `WRONG_CONTENT_TYPE` IS.
 * "Your JSON is shaped wrong" and "your request was too big to read" are
 * different mistakes with different next actions, and an agent told the wrong
 * one shrinks nothing and re-sends. 413 rather than 400 because the status
 * already carries the distinction, so the sentence does not have to argue it.
 *
 * IT NAMES THE SIZE IN WORDS, NOT IN BYTES. The reader is a coding agent
 * relaying to a person, and "under a megabyte" is actionable where a five-digit
 * byte count is arithmetic. The number itself lives once, in `./server.ts`.
 */
export const BODY_TOO_LARGE: McpRefusal = Object.freeze({
  code: "body_too_large",
  message:
    "That request was too big to read, so none of it was looked at. This server only ever needs " +
    "a short message — a method name and at most a couple of ids — so send one under a megabyte.",
  status: 413,
});

/**
 * The body we could not read at all.
 *
 * RE-AUTHORED (D-12), for the same reason and with the same care. The previous
 * sentence named a `tool` field and an `input` field — this surface's own
 * pre-protocol envelope, which no MCP client has ever sent and which nothing
 * reads any more. The replacement names the JSON-RPC envelope that is actually
 * parsed, and still instructs: it says which method to send and where the
 * arguments go, so an agent that got the shape wrong can fix it from the
 * refusal alone without reading a document.
 *
 * IT HAS A PRODUCER AGAIN, AND IT IS THE ONE THE RE-AUTHORED SENTENCE WAS
 * WRITTEN FOR. The pre-protocol envelope reader that used to produce this is
 * gone, and for one sprint nothing did — the transport's own parse error
 * answers a body that is not JSON. What `./server.ts` now refuses with it is a
 * JSON-RPC BATCH: an array body, refused on its first non-whitespace byte
 * before the transport ever sees it. "Send a SINGLE JSON-RPC message" is
 * already the first instruction in the sentence, which is why no new sentence
 * was authored for it.
 */
export const MALFORMED_BODY: McpRefusal = Object.freeze({
  code: "malformed_request",
  message:
    "We could not read that request. Send a single JSON-RPC message: put the method you want " +
    "in a method field — tools/list to see what this server can do, or tools/call with the " +
    "tool's name and its arguments in a params field.",
  status: 400,
});

/**
 * A tool name that is not one of the three. The message is `resolveMcpTool`'s
 * own — it already lists the tools that exist and says which one to start from,
 * and re-authoring it here would be a second copy of a customer-facing string.
 *
 * 400 AND NEVER 500: asking for a tool that does not exist is an ordinary thing
 * for an agent to do, and a 500 tells it the server is broken rather than that
 * its request was.
 */
export function unknownTool(message: string): McpRefusal {
  return { code: "unknown_tool", message, status: 400 };
}

/** One thing that was wrong with the arguments, as a schema saw it. Declared
 * structurally rather than as Zod's own `ZodIssue`, because `apps/web` reads
 * `@growthmind/shared`'s schemas and deliberately does not depend on `zod`
 * itself — a second copy of Zod in this workspace is a second set of internals
 * for the shared schemas to fail `instanceof` against. */
export interface McpParseIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * Arguments that do not fit the tool's schema — including a `limit` above the
 * ceiling, which the contract bounds on both sides on purpose.
 *
 * 400 WITH THE REASONS, NEVER A 500 AND NEVER A STACK. An agent that is told
 * which field was wrong fixes the call; an agent that gets a 500 concludes the
 * server is down. Only the field path and the schema's own sentence travel —
 * never the value the agent sent, which may be somebody's id.
 */
export function malformedInput(tool: string, issues: readonly McpParseIssue[]): McpRefusal {
  const reasons = issues.map(describeIssue).join("; ");
  return {
    code: "malformed_request",
    message:
      reasons.length > 0
        ? `Some of what you sent does not fit ${tool}: ${reasons}.`
        : `Some of what you sent does not fit ${tool}.`,
    status: 400,
  };
}

function describeIssue(issue: McpParseIssue): string {
  // `String(...)` per segment rather than `path.join(".")`: a path segment is a
  // `PropertyKey`, and joining a symbol throws — a crash inside the code whose
  // whole job is to turn a bad request into a message.
  const where = issue.path.map((segment) => String(segment)).join(".");
  return where.length > 0 ? `${where} — ${issue.message}` : issue.message;
}

/**
 * The wire form of a refusal. ONE producer, so two refusals built from one
 * constant are identical by construction rather than by review — the key order
 * is this literal's, the status is the refusal's, and nothing else is added.
 */
export function refusalResponse(refusal: McpRefusal): Response {
  return Response.json(
    { ok: false, error: { code: refusal.code, message: refusal.message } },
    { status: refusal.status },
  );
}

/** One block of text, addressed to the model. Declared here rather than
 * imported from the SDK because this file names no transport — the shape is
 * the protocol's, but the dependency would be ours, and `./wire.ts` is the one
 * file allowed to hold it. */
export interface McpTextContent {
  readonly type: "text";
  readonly text: string;
}

/** A refusal as a TOOL EXECUTION ERROR — `isError: true` on an HTTP 200, never
 * a JSON-RPC error object. */
export interface McpToolErrorResult {
  readonly content: McpTextContent[];
  readonly isError: true;
}

/**
 * The other wire form of a refusal, and the SECOND of exactly two producers.
 *
 * THE SAME ARGUMENT AS `refusalResponse`, ONE LAYER IN. Once the surface speaks
 * JSON-RPC, a refusal can leave by two doors: as an HTTP response, before the
 * envelope exists (a missing key, a browser `Origin`, a body that is not JSON),
 * or as a tool result, once it does (`NOT_FOUND`, an unknown tool, arguments
 * that do not fit, our own fault). Two doors is one more than one, so each gets
 * exactly one producer and neither gets a literal. `./wire.ts` contains no
 * refusal literal at all — it calls this — which is what makes two refusals
 * built from one constant identical BY CONSTRUCTION rather than by review.
 * That identity is the cross-tenant proof: `NOT_FOUND` for somebody else's id
 * and `NOT_FOUND` for an id that never existed travel this function, in the
 * same order, with nothing added.
 *
 * `isError: true` RATHER THAN A JSON-RPC ERROR, DELIBERATELY. "There is nothing
 * here with that id" is business logic, and the spec reserves protocol errors
 * for unknown methods and malformed requests — which are framing, and therefore
 * the SDK's to emit, never ours. A refusal sent as a protocol error is also one
 * a client may render as a transport failure, which puts our sentence somewhere
 * the model never reads it.
 *
 * `refusal.status` is deliberately NOT read here. It is the HTTP door's field;
 * on this door the answer is 200 and the refusal is in the body. The constant
 * keeps its status because the same constant goes out both doors.
 *
 * NOT frozen, unlike the constants: the returned object is handed straight to
 * the SDK, and freezing a value another library owns the rendering of buys
 * nothing and can break it. The guarantee here is one producer, not one
 * instance.
 */
export function refusalToolResult(refusal: McpRefusal): McpToolErrorResult {
  return { content: [{ type: "text", text: refusal.message }], isError: true };
}
