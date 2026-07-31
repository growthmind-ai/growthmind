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
 * did not happen; none of them is a partial answer. */
export type McpRefusalCode =
  | "unauthenticated"
  | "wrong_method"
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
 * Every other method. Doubles as the plainest statement of what this surface
 * is: it reads, and there is no verb here that does anything else.
 */
export const WRONG_METHOD: McpRefusal = Object.freeze({
  code: "wrong_method",
  message:
    "This server only reads. Send a POST to call one of its tools, or a GET to see the tools " +
    "that exist. Nothing here changes anything.",
  status: 405,
});

/** The body we could not read at all. */
export const MALFORMED_BODY: McpRefusal = Object.freeze({
  code: "malformed_request",
  message:
    "We could not read that request. Send JSON with the name of the tool you want in a tool " +
    "field, and that tool's arguments in an input field.",
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
