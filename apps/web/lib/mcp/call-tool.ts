// THE TOOL CORE: EVERY DECISION THIS SURFACE MAKES, AND NO TRANSPORT (O-013).
//
// ⚠️ SIGNATURE-ONLY STUB. The types below are final; the body is not written.
// Task 7.1 moves the real implementation down from `./server.ts` and deletes
// the throw. The stub exists so the Wave 0 suite can TYPECHECK while it runs
// red — a test importing a module that does not exist fails to compile, and a
// suite that does not compile is broken, not red. See the ownership note at the
// foot of this file.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE MAY NOT NAME, AND WHY THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
//
// The seam this sprint exists to cut is: the SDK renders, and it never decides.
// One half of that seam is enforced by a source scan — this file may not
// contain the transport package's name, nor any identifier a wire layer is
// built from. That is not a style rule. A file that CAN name the wire will
// eventually branch on it, and the day it does, the security argument written
// at the top of `./server.ts` — authenticate first, take the organization from
// the credential and nowhere else, one read and one null branch, parse every
// output — stops being readable in one place.
//
// So what arrives here is a tool name off the wire, an unparsed argument value,
// a read port and a credential. What leaves is a union. There is no envelope,
// no status, no framing, and nothing in between that a transport could change.
//
// ---------------------------------------------------------------------------
// THE ORGANIZATION COMES FROM THE CREDENTIAL, STRUCTURALLY
// ---------------------------------------------------------------------------
//
// The credential is its OWN parameter, never a field on `input`. That is what
// makes "no argument off the wire can reach a read" a property of the signature
// rather than a promise in a comment: `input` is `unknown` until a tool's own
// schema parses it, no tool schema has an organization key, and the read port
// requires one — so the only value that can satisfy the port is the one that
// came from the key the caller presented.
import type { McpToolName } from "@growthmind/shared";

import type { McpCredential } from "./credentials";
import type { McpReadPort } from "./read-port";
import type { McpRefusal } from "./refusals";

/**
 * What one tool call came to. A VALUE, never something a caller can send back
 * out unexamined — the rendering layer decides how each arm reaches the client,
 * and this file decides which arm it is.
 *
 * `result` is `unknown` because it is a different shape per tool and has
 * already been parsed by the schema that owns it; typing it as a union of three
 * would be a second copy of the contract that could drift from the first.
 */
export type McpToolOutcome =
  | { readonly ok: true; readonly tool: McpToolName; readonly result: unknown }
  | { readonly ok: false; readonly refusal: McpRefusal };

/**
 * One tool call, decided.
 *
 * NEVER THROWS, AND NEVER RETURNS A TRANSPORT VALUE. Every failure — an unknown
 * name, arguments that do not fit, a row that is not there, a read that broke —
 * comes back as `{ ok: false, refusal }`. A fault inside a read, a renderer or
 * an output schema is caught here and becomes `UNAVAILABLE`, so the caller
 * above never has to distinguish "this refused" from "this exploded".
 *
 * `name` is UNRESOLVED ON PURPOSE — it is a raw string off the wire, and
 * `resolveMcpTool` owns turning it into one of the three or into the refusal
 * that names all three.
 */
export async function callTool(
  name: string,
  input: unknown,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  // The four parameters are named exactly as the contract pins them. This line
  // only keeps the stub lint-clean; task 7.1 deletes it and uses them.
  void [name, input, reads, credential];
  throw new Error("mcp: callTool has no implementation yet — task 7.1 owns the body");
}

// ---------------------------------------------------------------------------
// OWNERSHIP HANDOFF — this is not a second author on one file
// ---------------------------------------------------------------------------
//
// The sprint's rule is that exactly one task owns each source file. This file
// was CREATED by the scaffold task (2.3) with types and no behaviour, and is
// IMPLEMENTED by task 7.1, in a later wave. The two never run at the same time,
// so there is no concurrent write and the rule is intact. Task 7.1 replaces the
// body and the throw; it should keep the types above, because the Wave 0 rows
// were authored against them.
