// THE PROTOCOL VOCABULARY OF THE READ-ONLY MACHINE SURFACE (O-013).
//
// Every protocol revision, header name and JSON-RPC error code this surface
// names, in one file, so that `./server.ts` and `./wire.ts` contain no inline
// literal of any of them. That rule is not tidiness: a header name or an error
// code written inline is a value the compiler cannot check, so the wrong one is
// a silent no-op at runtime rather than a red squiggle — the exact class of bug
// the edge taxonomy files under "stringly-typed keys". Named here, a typo is a
// build failure.
//
// ---------------------------------------------------------------------------
// THIS FILE NAMES NO PACKAGE, AND THAT IS LOAD-BEARING
// ---------------------------------------------------------------------------
//
// `./wire.ts` is the ONE source file in `apps/web/lib/**` and `apps/web/app/**`
// permitted to name the transport package, and a source scan asserts the list
// has exactly one entry. A type-only import here would still put the package
// name in this file's source text and turn that list into two — so the two
// negotiation constants the package exports (`LATEST_PROTOCOL_VERSION`,
// `SUPPORTED_PROTOCOL_VERSIONS`) are compared against the constants below in
// the TEST file, which the scan excludes, and never imported here.
//
// If you came to this file to "fix" a missing import, that is the thing you
// would be breaking.

/**
 * The modern era this surface serves.
 *
 * Pinned by BEHAVIOUR (`WIRE-E7`), never by version string — the modern era
 * drops the `initialize` handshake, so it is absent from
 * `SUPPORTED_PROTOCOL_VERSIONS` by design and advertises itself via
 * `server/discover` instead. Measured: the modern leg answers
 * `{"supportedVersions":["2026-07-28"]}`. A claim-less POST is classified
 * LEGACY and answers `-32601` there — that is the legacy leg being correct, not
 * a missing feature.
 *
 * ⚠️ THE TRAP, NAMED. `SUPPORTED_PROTOCOL_VERSIONS` is the LEGACY-ERA
 * NEGOTIATION LIST. A revision that has no handshake has nothing to negotiate,
 * so its absence from a list of negotiable versions is correct and is asserted
 * on purpose. Anyone who makes a failing revision assertion pass by adding
 * `2026-07-28` to that list has misunderstood which list they are reading. The
 * modern era is proved by a real client that refuses to connect any other way.
 *
 * This constant was DELETED once, on a probe that sent a claim-less POST to
 * `server/discover`, read `-32601`, and concluded the modern era was unserved.
 * It was measuring the legacy leg. The constant is restored, and this paragraph
 * exists so the deletion is not repeated. See `tasks/mcp-wire-protocol/probe-notes.md`.
 */
export const MCP_PROTOCOL_ERA_TARGET = "2026-07-28";

/**
 * The legacy floor this surface serves — and the era a stock client actually
 * negotiates, with no options at all, which makes it the leg the north star
 * depends on.
 *
 * Pinned by version string (`WIRE-K3`/`WIRE-K4`), because unlike the era above,
 * this one IS negotiated: it is a member of the package's own
 * `SUPPORTED_PROTOCOL_VERSIONS`, and a package upgrade that moved the list
 * would move what this server answers.
 */
export const MCP_PROTOCOL_LEGACY_FLOOR = "2025-11-25";

/**
 * The header names this surface reads, lowercase because `Headers` lookups are
 * case-insensitive and one spelling beats two.
 *
 * `ORIGIN` is the whole browser gate: its PRESENCE is the refusal condition, so
 * the name is the rule. `CONTENT_TYPE` is the JSON gate. `SESSION_ID` and
 * `PROTOCOL_VERSION` are the protocol's own, read by the transport rather than
 * by us — named here so that if anything of ours ever reads one, it reads it
 * from the same place.
 *
 * The modern envelope's `Mcp-Method` / `Mcp-Name` headers are deliberately
 * ABSENT: a client sends them and the transport reads them, and nothing of ours
 * ever will. A constant for a header we do not read is a claim we do.
 */
export const MCP_HEADER = {
  SESSION_ID: "mcp-session-id",
  PROTOCOL_VERSION: "mcp-protocol-version",
  ORIGIN: "origin",
  CONTENT_TYPE: "content-type",
} as const;

/**
 * The JSON-RPC error codes this surface can be ON THE WIRE WITH — every one of
 * them emitted by the transport, none of them by us.
 *
 * WE EMIT NONE OF THESE, AND THAT IS THE POINT. Protocol-level errors are
 * framing: a body that is not JSON, a method that does not exist, params that
 * do not fit the envelope. Framing belongs to the transport, the same way
 * negotiation does. Everything OUR code refuses — a missing key, a browser
 * caller, an id that is not there, a tool that does not exist, arguments that
 * do not fit a tool's schema, our own fault — leaves as a refusal with a
 * sentence in it, never as an error code (see `./refusals.ts`).
 *
 * So this object is a TRIPWIRE rather than a vocabulary in use: it is the list
 * a test walks to prove no code we emit falls in the spec-reserved
 * `-32020…-32099` band or the legacy `-32000…-32019` band. The day somebody
 * hand-rolls an error object, they will add its code here, and the test will
 * either pass — proving the code is legal — or fail loudly. A magic number
 * typed inline gets neither.
 */
export const JSON_RPC_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
} as const;
