// THE MODERN LEG, MINTED BY HAND — the decision `./mcp-fixture.ts` asked for
// (O-013, post-sprint audit).
//
// ===========================================================================
// WHY THIS IS A SECOND FILE AND NOT A THIRD CONSTRUCTOR IN THE FIXTURE
// ===========================================================================
//
// `./mcp-fixture.ts`'s header says, in as many words: every request minted
// there classifies LEGACY, that is load-bearing rather than convenient, and
// "DO NOT ADD A MODERN-ENVELOPE VARIANT TO THIS FILE WITHOUT A DECISION". The
// reasons it gives are all still true — roughly forty rows across four files
// fingerprint whole bodies against the legacy frame, `WIRE-G6` asserts an
// `Accept` 406 that only the legacy leg produces, and legacy is the leg a stock
// client actually negotiates.
//
// So the decision is: the fixture keeps its claim WHOLE and this file carries
// the modern minter instead. Nothing here is reachable from a legacy row by
// accident, and a reader of the fixture is never one autocomplete away from
// moving a byte-identity row onto the other leg.
//
// ---------------------------------------------------------------------------
// WHY A HAND-MINTED MODERN REQUEST EXISTS AT ALL
// ---------------------------------------------------------------------------
//
// Until the post-sprint audit the modern leg was exercised in exactly one
// place — through a real `Client` pinned to the era in `../real-client.test.ts`
// — and a real client only ever sends the handful of messages a real client
// sends. Two things needed asserting that no real client will ever ask for:
//
//   1. `subscriptions/listen`, which a stock client never sends and which hung
//      this surface for as long as a caller cared to hold it open (H-1).
//   2. The D7 identity proof on the modern leg. The crown jewel is authored
//      entirely on the legacy leg because the fixture is legacy-only by
//      design; the property was measured identical on the modern leg and
//      nothing asserted it.
//
// Both are requests a real client cannot be made to send, so both need a
// request built by hand. That is the whole justification for this file — not
// convenience, and not a preference for hand-built requests over real ones.
//
// ---------------------------------------------------------------------------
// WHAT MAKES A REQUEST MODERN
// ---------------------------------------------------------------------------
//
// MEASURED, not read off a document. A request classifies MODERN when it
// carries the three `_meta` claim keys inside `params` AND an `Mcp-Method`
// header naming the same method — plus, for a tool call, an `Mcp-Name` header
// naming the tool. Anything less classifies LEGACY, which is why the fixture's
// per-request header override is explicitly NOT a door to this leg: the claim
// keys live in the BODY, and the fixture builds that.
//
// ⚠️ THE ANSWERS DIFFER FROM THE LEGACY LEG'S, BY DESIGN. A modern result
// carries `resultType: "complete"` and a `_meta.serverInfo` block the legacy
// frame does not. Every row using this minter therefore compares modern against
// modern and never against a legacy literal — the same discipline
// `../cross-tenant.test.ts` states for its own frame constant.
import { MCP_URL, WIRE_HEADERS } from "./mcp-fixture";

/**
 * The era this minter claims. Deliberately the same value
 * `../../lib/mcp/wire-constants.ts` pins as `MCP_PROTOCOL_ERA_TARGET`, but
 * NOT imported from it: this file's job is to speak the protocol the way a
 * foreign client would, and a request built out of our own constant would
 * agree with the server for the wrong reason. `WIRE-K` already pins that our
 * constant matches what the package serves.
 */
const MODERN_REVISION = "2026-07-28";

/** The three `_meta` claim keys the transport classifies on, and the two
 * headers that must agree with them. Spelled out rather than imported for the
 * reason above. */
const PROTOCOL_VERSION_CLAIM = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_CLAIM = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_CLAIM = "io.modelcontextprotocol/clientCapabilities";

const MCP_METHOD_HEADER = "mcp-method";
const MCP_NAME_HEADER = "mcp-name";

/** Who the hand-minted client says it is. A real client sends a name and a
 * version; nothing negotiates on either. */
const CLIENT_INFO = { name: "growthmind-modern-envelope", version: "0.0.0" } as const;

export interface ModernRequestInput {
  /** The JSON-RPC method, which must also be the `Mcp-Method` header. */
  readonly method: string;
  /** The tool name for a `tools/call`, which must also be the `Mcp-Name`
   * header. Omitted for every other method. */
  readonly name?: string;
  /** Everything except `_meta`, which this function stamps. */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly key?: string | null;
  /** Follows the fixture's rule and defaults to 1, so two answers compared
   * byte for byte share the id echoed into both. */
  readonly id?: number | string;
}

/**
 * One MODERN-envelope JSON-RPC request, as a real `Request`.
 *
 * The `accept` and `content-type` headers are the fixture's `WIRE_HEADERS`, so
 * a row here deviates from a legacy row in exactly one respect — the leg — and
 * never in a header somebody forgot.
 */
export function modernRequest(input: ModernRequestInput): Request {
  const headers = new Headers(WIRE_HEADERS);
  headers.set(MCP_METHOD_HEADER, input.method);
  if (input.name !== undefined) {
    headers.set(MCP_NAME_HEADER, input.name);
  }
  if (typeof input.key === "string") {
    headers.set("authorization", `Bearer ${input.key}`);
  }

  const params: Record<string, unknown> = {
    ...input.params,
    _meta: {
      [PROTOCOL_VERSION_CLAIM]: MODERN_REVISION,
      [CLIENT_INFO_CLAIM]: CLIENT_INFO,
      [CLIENT_CAPABILITIES_CLAIM]: {},
    },
  };

  return new Request(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: input.id ?? 1,
      method: input.method,
      params,
    }),
  });
}

/**
 * A MODERN `tools/call`, with the tool name in both places the protocol wants
 * it: `params.name` and the `Mcp-Name` header.
 *
 * Two places is one more than one, and that is the protocol's choice rather
 * than ours — a helper that set only one of them would classify LEGACY (no
 * header) or be rejected on a header mismatch, and a row failing that way looks
 * like a server bug.
 */
export function modernToolCallRequest(input: {
  tool: string;
  input?: unknown;
  key?: string | null;
  id?: number | string;
}): Request {
  return modernRequest({
    method: "tools/call",
    name: input.tool,
    params: { name: input.tool, arguments: input.input ?? {} },
    ...(input.key === undefined ? {} : { key: input.key }),
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}
