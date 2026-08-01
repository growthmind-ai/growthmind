// THE WIRE: THE ONE FILE THAT KNOWS THIS IS MCP (O-013).
//
// ⚠️ SIGNATURE-ONLY STUB. The entry point below is declared and not written.
// Task 8.1 builds the real renderer. The stub exists so the Wave 0 suite can
// TYPECHECK while it runs red — a test importing a module that does not exist
// fails to compile, and a suite that does not compile is broken, not red. See
// the ownership note at the foot of this file.
//
// ---------------------------------------------------------------------------
// THE ONE IMPORT SITE
// ---------------------------------------------------------------------------
//
// This is the only source file in `apps/web/lib/**` and `apps/web/app/**`
// permitted to name `@modelcontextprotocol/server`, and a source scan asserts
// that the list of files naming it has exactly one entry. That confinement is
// what makes "we could swap the transport out" a fact rather than a hope:
// swapping it changes this file's imports and nothing else — no tool logic, no
// refusal sentence, no credential code, no schema.
//
// The v1 SDK package — the `/sdk` specifier under the same scope, seventeen
// runtime dependencies, no modern-era machinery — is imported NOWHERE in this
// workspace, and a second scan asserts zero occurrences of its name anywhere.
// That scan is why its specifier is not spelled out even in this comment: a
// prose mention would be an occurrence, and the row would go red on a sentence
// that was only trying to be helpful. If you are here from v1 muscle memory,
// the transport lives on the package ROOT export; there is no deep subpath.
//
// ---------------------------------------------------------------------------
// IT RENDERS, AND IT NEVER DECIDES
// ---------------------------------------------------------------------------
//
// Task 8.1 fills this in, and the contract it fills it to is worth stating
// before the first line is written:
//
//   - The handler is constructed PER REQUEST, with `await handler.close()` in a
//     `finally`. That keeps `getDb()` per-request inside the composition root's
//     `resolveMcpDeps()` — an invariant a module-scope memoised handler would
//     silently break. (`createMcpHandler` returns an OBJECT, not a callable:
//     serve with `handler.fetch(request)`.)
//   - `responseMode: "sse"` is written out AS A PROPERTY at the construction
//     site, never left to the SDK's `'auto'` default and never `"json"`. The
//     legacy leg — the one a stock client meets — has no framing option at all,
//     so `"json"` would not make the wire JSON; it would split the wire in two
//     and force every byte-identity row to be authored twice. One framing, one
//     set of rows. The literal must stay visible here rather than being hoisted
//     into a constant: a test asserts it is present at this construction site.
//   - `legacy: "stateless"` is passed EXPLICITLY. It is the verified default,
//     and it is now load-bearing: the only alternative makes a stock client fail
//     its first POST.
//   - The three tools are registered with the shared Zod schemas VERBATIM, and
//     then `tools/call` is overridden as ONE handler for the method, on the
//     inner `Server`, AFTER the registration loop. Registration alone is not
//     enough — the facade resolves the tool name against its own registry first
//     and answers an unknown name with a protocol error carrying none of our
//     three tool names, which is precisely the refusal this surface exists to
//     give well.
//   - A refusal is rendered by calling `refusalToolResult` from `./refusals.ts`.
//     THIS FILE CONTAINS NO REFUSAL LITERAL — one producer per wire form is what
//     makes two refusals built from one constant identical by construction, and
//     that identity is the cross-tenant proof.
//   - Every non-error result carries schema-valid `structuredContent`, built
//     from the same parsed output value, uniformly on every success. A client
//     that has listed the tools first compiles output validators from that
//     listing and REJECTS a result without it — measured, and invisible to any
//     server-side test.
import type { McpCredential } from "./credentials";
import type { McpReadPort } from "./read-port";

/**
 * What the renderer cannot work out for itself: where the answers come from,
 * and who is asking.
 *
 * The credential arrives ALREADY RESOLVED. Authentication happens in
 * `./server.ts`, on the raw request, before this file is reached at all — which
 * is what keeps the 401 out of the JSON-RPC envelope entirely and makes the
 * largest refusal-identity set in the sprint immune to anything the transport
 * does.
 */
export interface McpWireDeps {
  readonly reads: McpReadPort;
  readonly credential: McpCredential;
}

/**
 * Serve one authenticated, gated request over the MCP wire.
 *
 * Called by `./server.ts` after it has authenticated the caller and cleared the
 * Origin, Content-Type and method gates. Everything from here down is framing:
 * negotiation, the envelope, error codes for malformed input, and the shape a
 * result travels in are all the transport's, and none of them is a decision
 * this codebase makes.
 */
export async function renderMcpWire(request: Request, deps: McpWireDeps): Promise<Response> {
  // Named exactly as the caller will pass them. This line only keeps the stub
  // lint-clean; task 8.1 deletes it and uses them.
  void [request, deps];
  throw new Error("mcp: renderMcpWire has no implementation yet — task 8.1 owns the body");
}

// ---------------------------------------------------------------------------
// OWNERSHIP HANDOFF — this is not a second author on one file
// ---------------------------------------------------------------------------
//
// The sprint's rule is that exactly one task owns each source file. This file
// was CREATED by the scaffold task (2.3) with a signature and no behaviour, and
// is IMPLEMENTED by task 8.1, in a later wave. The two never run at the same
// time, so there is no concurrent write and the rule is intact.
//
// Task 8.1 owns the entry point's final shape as well as its body. No Wave 0
// test imports `renderMcpWire` — the suite drives the real exported route
// handler, and the two rows that care about this file read its SOURCE TEXT
// (the `responseMode` literal, and the one-import-site scan). So renaming or
// re-shaping this function costs nothing downstream; only `./server.ts` calls
// it, and task 8.1 lands after the task that rewrites `./server.ts`.
