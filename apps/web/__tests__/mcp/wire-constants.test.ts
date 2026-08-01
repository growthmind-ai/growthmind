// THE PROTOCOL VOCABULARY, PINNED — WIRE-K1…K6 (O-013, lane W0-T-A, D9).
//
// Six rows over the values a wire protocol is spelled with: header names, error
// codes, two protocol revisions, and the framing mode the responses arrive in.
// None of them is about behaviour a user can see, and every one of them is
// about a value that fails SILENTLY when it is wrong — a header name typo'd
// inline reads nothing forever, an error code in a reserved band is a
// well-formed lie, a revision string moved by a package upgrade changes what
// this server negotiates with no diff of ours, and a framing mode left to a
// default moves every byte-identity comparison in the sprint.
//
// ---------------------------------------------------------------------------
// ⚠️ THIS FILE IS THE MOST CHANGED IN THE ROUND-2 REGENERATION
// ---------------------------------------------------------------------------
//
// Round 1 authored `WIRE-K5` and `WIRE-K6` to two decisions round 2 REVERSED,
// and writing either old version here would turn a row red against correct
// code. Both reversals came from one mis-measured probe — a claim-less POST to
// `server/discover` that read `-32601`, concluded the modern era was unserved,
// and drove (1) "ship legacy-only, delete `MCP_PROTOCOL_ERA_TARGET`" and
// (2) `responseMode: "json"`. The POST was classified LEGACY, and `-32601` is
// the correct legacy answer. Measured since:
//
//   - both eras are served by one handler and THERE IS NO MODERN-OFF SWITCH, so
//     round 1's `WIRE-K5(b)(c)` ("the modern era is neither served nor
//     negotiated") is not merely wrong but UNASSERTABLE — no test could produce
//     the behaviour it claims. Half (a) survives, retitled.
//   - `responseMode` is INERT on the legacy leg, so `"json"` does not make the
//     wire JSON; it splits the wire in two. The pin is `"sse"`, and `WIRE-K6`
//     is authored to it. Round 1's "no body starts with `event: `" is deleted
//     as false by design: under the SSE pin every SDK-rendered body begins
//     exactly that way.
//
// If a future reader finds `2026-07-28` missing from a negotiation list and
// reaches to add it: that absence is asserted ON PURPOSE by `WIRE-K5`, and the
// reason is written into `wire-constants.ts` itself. The modern era drops the
// `initialize` handshake, so it has nothing to negotiate. `WIRE-E7` proves it
// is served, by behaviour, with a real client.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE MAY IMPORT THE TRANSPORT PACKAGE AND `wire-constants.ts` MAY NOT
// ---------------------------------------------------------------------------
//
// `WIRE-S4` asserts that exactly ONE shipped source file names the transport
// package, and it excludes test files from the scan. `wire-constants.ts`
// therefore names no package at all — not even type-only, because a type-only
// import still puts the name in the file's source text — and the comparison
// against the package's own exported constants happens HERE instead. The ADD's
// D-4 file table says otherwise; that cell is wrong, and following it would put
// a second entry in `WIRE-S4`'s list.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";
import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  JSON_RPC_ERROR_CODE,
  MCP_HEADER,
  MCP_PROTOCOL_ERA_TARGET,
  MCP_PROTOCOL_LEGACY_FLOOR,
} from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rpcRequest,
  toolCallRequest,
  verbRequest,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const SERVER_SRC = "apps/web/lib/mcp/server.ts";
const WIRE_SRC = "apps/web/lib/mcp/wire.ts";
const WIRE_CONSTANTS_SRC = "apps/web/lib/mcp/wire-constants.ts";

function sourceOf(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * THE ONE LITERAL TWO ROWS SHARE, DECLARED ONCE.
 *
 * `WIRE-K6(a)` requires this exact text to be present in `wire.ts`'s CODE, and
 * `WIRE-K1` exempts this exact text from its inline-literal ban. One constant
 * for both means the exemption can never drift away from the thing it exempts:
 * if a future edit writes the property differently, both rows go red together
 * and point at the same fix, rather than one silently permitting what the other
 * cannot find.
 *
 * `"sse"` AND NOT `"json"`. The legacy leg — the one a stock client negotiates
 * — has no framing option at all, so `"json"` would leave the legacy wire SSE
 * and make the modern wire JSON: two framings, and every byte-identity row
 * authored twice.
 */
const RESPONSE_MODE_PIN = 'responseMode: "sse"';

// ---------------------------------------------------------------------------
// A comment-blanking scanner (the code half of a source file)
// ---------------------------------------------------------------------------

/**
 * Returns `source` with every comment replaced by spaces, character for
 * character, newlines preserved — and every string literal LEFT INTACT, because
 * string literals are exactly what these rows are about.
 *
 * ⚠️ THE INVERSE OF `refusal-identity-guard.test.ts`'s scanner, and the
 * difference matters. That one blanks comments AND strings, because it asks
 * "did an assertion get loosened" and a token inside a string is data. These
 * rows ask "is this value written inline in the code", so the strings are the
 * evidence and the comments are the noise.
 *
 * WITHOUT THIS, `WIRE-K6(a)` PASSES FOR THE WRONG REASON TODAY. `wire.ts`'s
 * header already discusses `responseMode: "sse"` in prose, so a raw-text scan
 * finds the literal, goes green, and stays green through a wave that never
 * writes the property at all. A row that a comment can satisfy is a row about
 * comments.
 *
 * Quotes are honoured so that a `//` inside a string cannot be mistaken for a
 * comment opener and blank the rest of a line.
 */
function codeOnly(source: string): string {
  const out: string[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const stop = source.indexOf("\n", index);
      const end = stop === -1 ? source.length : stop;
      out.push(" ".repeat(end - index));
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const stop = source.indexOf("*/", index + 2);
      const end = stop === -1 ? source.length : stop + 2;
      for (let i = index; i < end; i += 1) {
        out.push(source[i] === "\n" ? "\n" : " ");
      }
      index = end;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === char) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      const end = Math.min(cursor, source.length);
      out.push(source.slice(index, end));
      index = end;
      continue;
    }

    out.push(char);
    index += 1;
  }

  return out.join("");
}

/** The comment text of a source file — the other half, for the row that asserts
 * a REASON is written down rather than a value. */
function commentsOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// WIRE-K1 — nothing protocol-shaped is written inline
// ---------------------------------------------------------------------------

describe("WIRE-K1 — every header name and error code this surface names is an exported constant, never an inline literal", () => {
  /**
   * The values that must come from `wire-constants.ts`, DERIVED FROM IT rather
   * than retyped — so a fifth header added there is covered by this row the day
   * it is added, with nobody remembering to widen a list.
   *
   * The two protocol revisions are in the set as well as the header names.
   * `wire-constants.ts`'s own header states the rule that way ("every protocol
   * revision, header name and JSON-RPC error code … so that `./server.ts` and
   * `./wire.ts` contain no inline literal of any of them"), and a revision
   * string written inline is the same class of bug as a header name: a value
   * the compiler cannot check, wrong silently.
   */
  const HOISTED_VALUES: readonly string[] = [
    ...Object.values(MCP_HEADER),
    MCP_PROTOCOL_LEGACY_FLOOR,
    MCP_PROTOCOL_ERA_TARGET,
  ];

  /**
   * The SDK's framing-mode union, banned as a bare literal — and the reason the
   * exemption below exists at all.
   *
   * The framing mode is decided in exactly ONE place: the construction site in
   * `wire.ts`, spelled as the property `RESPONSE_MODE_PIN`. A bare `"sse"`
   * anywhere else is a second place the framing is decided, and two places is
   * how a wire ends up half-pinned.
   */
  const FRAMING_MODES = ["auto", "sse", "json"] as const;

  /**
   * ⚠️ THE EXEMPTION, ENCODED AS DATA AND NOT AS A COMMENT.
   *
   * `responseMode: "sse"` is a member of the SDK's own `'auto' | 'sse' | 'json'`
   * union, so a wrong value is a COMPILE error rather than a runtime one — the
   * exact property D9 asks a hoisted constant to provide, already provided by
   * the type. And `WIRE-K6(a)` requires the literal to be visible AT THE
   * CONSTRUCTION SITE, so hoisting it into a constant would break that row.
   *
   * DO NOT "FIX" A `WIRE-K1` FAILURE BY MOVING THE LITERAL INTO A CONSTANT.
   * The scanner strips this phrase before it looks, and the test below proves
   * the strip is what makes the difference.
   */
  const EXEMPT_INLINE_LITERALS = [RESPONSE_MODE_PIN] as const;

  /**
   * Every banned value written inline in the CODE of `source`, with the exempt
   * phrases removed first. Returned as a list rather than a count so a failure
   * names the literal that crept in.
   */
  function inlineOffences(source: string, exempt: readonly string[]): readonly string[] {
    let code = codeOnly(source);
    for (const phrase of exempt) {
      code = code.split(phrase).join(" ");
    }

    const offences: string[] = [];

    for (const value of [...HOISTED_VALUES, ...FRAMING_MODES]) {
      for (const quote of ['"', "'", "`"]) {
        const literal = `${quote}${value}${quote}`;
        if (code.includes(literal)) {
          offences.push(literal);
        }
      }
    }

    // Any JSON-RPC error code, not only the four we name: the ban is on writing
    // one inline, and the codes nobody hoisted are the ones most likely to be.
    for (const match of code.match(/-32\d{3}\b/g) ?? []) {
      offences.push(match);
    }

    return offences.toSorted();
  }

  test("server.ts writes no header name, revision or error code inline", () => {
    expect(inlineOffences(sourceOf(SERVER_SRC), EXEMPT_INLINE_LITERALS)).toEqual([]);
  });

  test("wire.ts writes none either, apart from the one exempt framing literal", () => {
    expect(inlineOffences(sourceOf(WIRE_SRC), EXEMPT_INLINE_LITERALS)).toEqual([]);
  });

  // THE EXEMPTION, PROVED TO BE LOAD-BEARING. Without it the construction site
  // is an offence; with it, it is not. If this pair ever stops disagreeing, the
  // exemption has become decoration and `WIRE-K6(a)` is the only thing left
  // holding the pin.
  test("the construction-site literal is an offence without the exemption and clean with it", () => {
    const site = `const handler = createMcpHandler(factory, { ${RESPONSE_MODE_PIN}, legacy: "stateless" });`;

    expect(inlineOffences(site, [])).toEqual(['"sse"']);
    expect(inlineOffences(site, EXEMPT_INLINE_LITERALS)).toEqual([]);
  });

  // NON-VACUITY. A scanner that reads nothing reports nothing forever, and this
  // one has two ways to go blind: `codeOnly` could over-blank, or the derived
  // value list could come back empty.
  test("the scanner finds what it is looking for in a known-positive control, and ignores prose", () => {
    const guilty = [
      `const name = "${MCP_HEADER.SESSION_ID}";`,
      "const code = -32601;",
      `const era = "${MCP_PROTOCOL_ERA_TARGET}";`,
    ].join("\n");

    // Sorted, so the list reads the same on every run — quoted literals first,
    // because a quote sorts below a minus sign.
    expect(inlineOffences(guilty, EXEMPT_INLINE_LITERALS)).toEqual([
      `"${MCP_PROTOCOL_ERA_TARGET}"`,
      `"${MCP_HEADER.SESSION_ID}"`,
      "-32601",
    ]);

    // The same three, discussed in a comment, are not uses of them.
    const innocent = `// never write "${MCP_HEADER.SESSION_ID}" or -32601 or "${MCP_PROTOCOL_ERA_TARGET}" inline\nconst a = 1;`;
    expect(inlineOffences(innocent, EXEMPT_INLINE_LITERALS)).toEqual([]);

    expect(HOISTED_VALUES.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// WIRE-K2 — no code we emit is in a band that is not ours
// ---------------------------------------------------------------------------

/**
 * The two bands a code of ours may never fall in: `-32099…-32020`, reserved by
 * the spec, and `-32019…-32000`, the legacy implementation-defined range.
 *
 * A TRIPWIRE, NOT A VOCABULARY IN USE. We emit none of these codes — protocol
 * errors are framing and framing is the transport's (D-7). `JSON_RPC_ERROR_CODE`
 * exists so that the day somebody hand-rolls an error object and adds its code
 * there, this row either passes (the code is legal) or fails loudly. A magic
 * number typed inline gets neither.
 */
function inABannedBand(code: number): boolean {
  return (code >= -32099 && code <= -32020) || (code >= -32019 && code <= -32000);
}

describe("WIRE-K2 — no emitted error code falls in the spec-reserved or legacy bands", () => {
  test("every code in JSON_RPC_ERROR_CODE is outside both bands", () => {
    const entries = Object.entries(JSON_RPC_ERROR_CODE);

    // The walk saw something: an empty object would satisfy the loop below
    // without asserting anything at all.
    expect(entries.length).toBeGreaterThan(0);

    for (const [name, code] of entries) {
      expect({ name, banned: inABannedBand(code) }).toEqual({ name, banned: false });
    }
  });

  // NON-VACUITY: the predicate really does fire, on one value from each band.
  test("the band check fires on a reserved code and on a legacy one", () => {
    expect(inABannedBand(-32050)).toBe(true);
    expect(inABannedBand(-32010)).toBe(true);
    expect(inABannedBand(JSON_RPC_ERROR_CODE.PARSE_ERROR)).toBe(false);
    expect(inABannedBand(JSON_RPC_ERROR_CODE.METHOD_NOT_FOUND)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WIRE-K3 / WIRE-K4 — the legacy negotiation list
// ---------------------------------------------------------------------------

/** Widened to `readonly string[]` at the import boundary. The package declares
 * this as a plain `string[]`, and pinning the type here keeps `WIRE-K5`'s
 * `not.toContain` a runtime claim rather than something a literal tuple type
 * could make un-writable. */
const SUPPORTED: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;

describe("WIRE-K3 — the legacy revision this server serves is one the package still negotiates", () => {
  /**
   * A claim about the LEGACY pin only. The modern pin is proved by behaviour in
   * `WIRE-E7`, with a real client, because a revision with no handshake cannot
   * appear in a list of negotiable versions.
   */
  test("SUPPORTED_PROTOCOL_VERSIONS contains the legacy floor this surface pins", () => {
    expect(SUPPORTED).toContain(MCP_PROTOCOL_LEGACY_FLOOR);
  });
});

describe("WIRE-K4 — the legacy negotiation list is pinned, so a package upgrade cannot move what this server negotiates", () => {
  /**
   * The literals are written out rather than derived, which is the whole point:
   * a `bun update` that changed either value would be a green test suite and a
   * different server. Recorded by probe W0-P5 and unchanged by round 2.
   *
   * THE `MCP_PROTOCOL_ERA_TARGET` CLAUSE STAYS REMOVED, even though the
   * constant itself is restored. Comparing a handshake-free era against a
   * negotiation list is the false assertion this ADD's first draft made.
   */
  test("the package's latest revision and its whole supported list are the measured ones", () => {
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-11-25");
    expect([...SUPPORTED_PROTOCOL_VERSIONS]).toEqual([
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
      "2024-10-07",
    ]);
  });
});

// ---------------------------------------------------------------------------
// WIRE-K5 — the modern era's absence from the legacy list, and the reason
// ---------------------------------------------------------------------------

describe("WIRE-K5 — the modern era is absent from the LEGACY NEGOTIATION LIST on purpose, and the reason is written down", () => {
  /**
   * ⚠️ ONE HALF ONLY. Round 1's halves (b) and (c) asserted that no source file
   * defines a constant whose value is `2026-07-28`, and that the modern era is
   * "neither served nor negotiated". Both are now false — Wave 2 restored
   * `MCP_PROTOCOL_ERA_TARGET`, and the modern leg is served by the same handler
   * with no way to switch it off. Authoring either would fail this row against
   * correct code.
   *
   * WHAT THIS ROW MUST NOT ASSERT: that the era is unserved. `WIRE-E7` proves
   * the opposite, with a real client.
   */
  const REASON_MARKERS = [MCP_PROTOCOL_ERA_TARGET, "initialize", "server/discover"] as const;

  /** Is the surprising absence explained in prose, in the file that holds the
   * constant? The three markers are the load-bearing words: the era it is about,
   * the handshake it drops, and what it advertises itself through instead. */
  function namesTheReason(source: string): boolean {
    const prose = commentsOnly(source);
    return REASON_MARKERS.every((marker) => prose.includes(marker));
  }

  test("the era target is not in the legacy list, and wire-constants.ts says why", () => {
    expect(SUPPORTED).not.toContain(MCP_PROTOCOL_ERA_TARGET);
    expect(namesTheReason(sourceOf(WIRE_CONSTANTS_SRC))).toBe(true);
  });

  // NON-VACUITY: prose that states the absence without explaining it does not
  // satisfy the scanner, and the scanner is reading comments rather than code.
  test("the reason scanner tells an explanation from a bare statement of the fact", () => {
    const explained = [
      `// The modern era ${MCP_PROTOCOL_ERA_TARGET} drops the initialize handshake, so it has`,
      "// nothing to negotiate and advertises itself via server/discover instead.",
    ].join("\n");
    const bare = `// The era is ${MCP_PROTOCOL_ERA_TARGET}.`;
    const inCodeOnly = `const era = "${MCP_PROTOCOL_ERA_TARGET}"; const m = "initialize"; const d = "server/discover";`;

    expect(namesTheReason(explained)).toBe(true);
    expect(namesTheReason(bare)).toBe(false);
    expect(namesTheReason(inCodeOnly)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WIRE-K6 — the framing, written out and asserted as two bands
// ---------------------------------------------------------------------------

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function deps(): McpServerDeps {
  return { credentials: CREDENTIALS, reads: fakeReadPort().port };
}

/** The two bands (D-6), both measured exactly. The SDK-rendered band carries no
 * charset suffix; the pre-SDK band carries the one `Response.json` adds. */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

/**
 * The five answers the bands are asserted over: three the SDK renders and two
 * our own `refusalResponse` produces before the SDK is in the call stack.
 *
 * The 405 is a `DELETE` rather than a `GET`, because `GET` is the verb the
 * transport itself answers during a real client's connect and its handling is
 * the SDK's business; `DELETE` is unambiguously ours, in both waves.
 */
const BAND_CASES: readonly {
  readonly name: string;
  readonly status: number;
  readonly contentType: string;
  readonly run: () => Promise<Response>;
}[] = [
  {
    name: "a tools/list",
    status: 200,
    contentType: SDK_RENDERED_CONTENT_TYPE,
    run: () => handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps()),
  },
  {
    name: "a tools/call",
    status: 200,
    contentType: SDK_RENDERED_CONTENT_TYPE,
    run: () =>
      handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }), deps()),
  },
  {
    name: "a not-found tool error",
    status: 200,
    contentType: SDK_RENDERED_CONTENT_TYPE,
    run: () =>
      handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "no-such-fix" }, key: KEY_A }),
        deps(),
      ),
  },
  {
    name: "an unauthenticated refusal",
    status: 401,
    contentType: PRE_SDK_CONTENT_TYPE,
    run: () => handleMcpRequest(rpcRequest({ method: "tools/list" }), deps()),
  },
  {
    name: "a wrong-method refusal",
    status: 405,
    contentType: PRE_SDK_CONTENT_TYPE,
    run: () => handleMcpRequest(verbRequest({ method: "DELETE", key: KEY_A }), deps()),
  },
];

describe("WIRE-K6 — the wire is SSE-framed on the SDK path and JSON on the pre-SDK path, because the response mode is written out rather than defaulted", () => {
  test("(a) wire.ts writes the response mode as a property at the construction site", () => {
    expect(codeOnly(sourceOf(WIRE_SRC))).toContain(RESPONSE_MODE_PIN);
  });

  // NON-VACUITY, AND THE REASON THE SCANNER STRIPS COMMENTS. `wire.ts`'s header
  // discusses the pin in prose today; a raw-text scan would find it there and
  // pass while the property was never written. These two controls prove the
  // strip is what separates a decision from a description.
  test("(a) a commented pin does not satisfy the scan and a written one does", () => {
    expect(codeOnly(`// ${RESPONSE_MODE_PIN} is the pin\nconst a = 1;`)).not.toContain(
      RESPONSE_MODE_PIN,
    );
    expect(codeOnly(`const options = { ${RESPONSE_MODE_PIN} };`)).toContain(RESPONSE_MODE_PIN);
  });

  for (const { name, status, contentType, run } of BAND_CASES) {
    test(`(b) ${name} carries ${contentType}`, async () => {
      const print = await fingerprint(await run());

      expect(print.status).toBe(status);
      expect(print.contentType).toBe(contentType);
    });
  }

  /**
   * (c) THE ASSERTION THAT KEEPS THE EMPTY EXCLUSION LIST HONEST.
   *
   * Byte-identity — the cross-tenant proof — compares whole response bodies.
   * The SSE spec permits a per-event `id:` line, and a transport that started
   * emitting one would make two identical requests differ by a line nobody
   * asserted about, quietly turning every identity row into a comparison of
   * bytes that are no longer stable. Measured today: no `id:` line is emitted
   * on either leg under any response mode, which is why the exclusion list is
   * EMPTY rather than "empty except the id".
   *
   * ⚠️ THE STATUS PRECONDITION IS NOT DECORATION. This is an absence assertion,
   * and a 400 refusal carries no `id:` line either — so without first proving
   * each response is the one this row means to inspect, (c) would pass today,
   * pass through wave 8, and pass on a surface that had stopped answering
   * correctly altogether.
   */
  for (const { name, status, run } of BAND_CASES) {
    test(`(c) ${name} contains no line beginning id:`, async () => {
      const print = await fingerprint(await run());

      expect(print.status).toBe(status);
      expect(linesBeginningWithId(print.body)).toEqual([]);
    });
  }

  // NON-VACUITY: the scanner does match a control SSE frame carrying one.
  test("(c) the scanner finds an id: line in a control frame that has one", () => {
    const withId = "event: message\nid: 42\ndata: {}\n\n";
    const without = 'event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n';

    expect(linesBeginningWithId(withId)).toEqual(["id: 42"]);
    // The `"id":1` inside the payload is not an SSE event id, and a scanner
    // that thought otherwise would fail every row for the wrong reason.
    expect(linesBeginningWithId(without)).toEqual([]);
  });
});

/** Every line of an SSE frame that begins an event-id field. String operations
 * only — never a parse, which would discard the framing this is about. */
function linesBeginningWithId(body: string): readonly string[] {
  return body.split("\n").filter((line) => line.startsWith("id:"));
}
