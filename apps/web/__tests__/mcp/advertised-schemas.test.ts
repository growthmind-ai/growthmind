// WHAT A CLIENT IS ACTUALLY SHOWN — WIRE-J1…J6 (O-013, lane W0-T-D).
//
// ===========================================================================
// THE SUBJECT OF THESE ROWS CHANGED, AND THE CHANGE MADE THEM STRONGER
// ===========================================================================
//
// Round 1 pointed all six rows at a `renderMcpToolSchemas()` in
// `packages/shared` that would turn the tool descriptors' Zod objects into
// JSON Schema. D-5 IS STRUCK: `registerTool` refuses a plain JSON Schema and
// takes a Standard Schema, Zod v4 already is one, so the shared objects are
// passed through verbatim and the SDK derives the advertised document from the
// same object it validates arguments with. `renderMcpToolSchemas` is never
// built, `packages/shared/src/mcp/json-schema.ts` is never created, and no
// `packages/*` source file changes in this sprint.
//
// EVERY CLAIM THE SIX ROWS MADE SURVIVES; ONLY THE SUBJECT MOVED — from a
// function of ours to THE DOCUMENT A REAL `tools/list` PUTS ON THE WIRE. That
// is what the customer's coding agent parses, so it is the stronger assertion:
// a renderer can be perfect and still be wired to nothing (D11), and a document
// read out of a real response cannot be.
//
// ---------------------------------------------------------------------------
// ERA-INDEPENDENT, AND AUTHORED ON THE LEGACY LEG
// ---------------------------------------------------------------------------
//
// `W0-P4` read the same `tools/list` over both protocol legs and reported them
// IDENTICAL on every axis these rows assert — `inputSchema`, `outputSchema`,
// `required`, `properties.limit.default`, and the root `type`. Only the FRAMING
// differs (SSE on the legacy leg, JSON on the modern one), which changes how a
// document is extracted and not what is true about it. So the whole file is
// minted through `./helpers/mcp-fixture.ts`, which mints legacy-leg requests
// only — the leg a stock client meets — and the extraction below is the SSE
// one.
//
// ---------------------------------------------------------------------------
// THE REAL ENTRY POINT, WITH A CREDENTIAL, AND NO DATABASE
// ---------------------------------------------------------------------------
//
// Every row drives the real exported `handleMcpRequest` with a resolving
// credential. `tools/list` is a catalogue read: it never reaches the read port
// and never reaches a table, so a real `gmak_` row on PGlite would add five
// seconds and prove nothing these rows claim. The credential is the fixture's
// fake source — the same one `../mcp/wire-envelope.test.ts` and
// `../mcp/wire-gates.test.ts` use. The credential path itself is proven with
// REAL minted keys in `./cross-tenant-real-keys.test.ts` and `./wiring.test.ts`.
//
// ---------------------------------------------------------------------------
// `JSON.parse` IS ALLOWED HERE, AND ONLY HERE-ISH
// ---------------------------------------------------------------------------
//
// `WIRE-R10` bans `JSON.parse(` in the four REFUSAL-IDENTITY suites
// (`cross-tenant`, `cross-tenant-real-keys`, `credentials`,
// `api-key-credentials`), because those rows compare BYTES and a parse throws
// away the framing that is half of the comparison. This file is not one of
// them and is not scanned: `WIRE-J3` is explicitly a walk of the PARSED
// documents, and a JSON Schema document is a tree whose KEYS are the subject.
// Extracting the `data:` payload out of the SSE frame still uses the fixture's
// string-operations-only helper, so the parse begins at the JSON-RPC message
// and never at the frame.
//
// ---------------------------------------------------------------------------
// RED UNTIL WAVE 8, AND RED IN ONE PLACE
// ---------------------------------------------------------------------------
//
// `apps/web/lib/mcp/wire.ts` is a signature-only stub and `server.ts` still
// reads its pre-protocol `{tool, input}` envelope, so a `tools/list` message
// reaches the route today as an object with no `tool` key and comes back HTTP
// 400 `MALFORMED_BODY`. Nothing is advertised at all. Every row below therefore
// asserts the three tool names FIRST — an advertisement that could not be read
// yields an empty list, and a row that only walked "every advertised document"
// would pass vacuously over nothing.
//
// Lane prefix `mcpadv`.
import { LIST_OPEN_FIXES_DEFAULT_ITEMS, MCP_TOOL, MCP_TOOL_NAMES } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { UNAVAILABLE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rpcRequest,
  sseDataLines,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";

/** The content type of every answer the SDK rendered, under the pinned
 * `responseMode: "sse"` (D-4/D-6). Measured exactly: no charset suffix. */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

/** The JSON Schema dialect Zod v4 renders and MCP expects — so no conversion
 * step exists anywhere in this codebase, which is the point of `WIRE-J5`. */
const EXPECTED_DIALECT = "draft/2020-12";

/**
 * The three keys that would mean a Zod object had leaked onto the wire.
 *
 * `~standard` is the Standard Schema entry point Zod v4 carries and the SDK
 * reads; `_def` is Zod's internal node; `parse` is its method. The descriptor
 * objects we hand `registerTool` carry all three BY DESIGN (D-8) — that is why
 * registration works at all. What must never happen is one of them travelling
 * out in the advertised document, where a client would try to serialise a
 * function or, worse, act on it.
 */
const FORBIDDEN_SCHEMA_KEYS = ["~standard", "_def", "parse"] as const;

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

/** A resolving credential and an EMPTY store. No row here reads data — a
 * catalogue is a static contract — so the store exists only to satisfy the
 * handler's dependency. */
function deps(): McpServerDeps {
  return { credentials: CREDENTIALS, reads: fakeReadPort().port };
}

// ---------------------------------------------------------------------------
// The advertised document, as it actually arrives
// ---------------------------------------------------------------------------

/**
 * One tool as `tools/list` advertises it.
 *
 * DECLARED HERE RATHER THAN IMPORTED FROM THE TRANSPORT PACKAGE, deliberately:
 * `apps/web/lib/mcp/wire.ts` is the ONE file in this workspace permitted to
 * name `@modelcontextprotocol/server`, and the point of these rows is what a
 * FOREIGN client parses out of the response — not what our own package's types
 * say should be in it. The two schema fields are `unknown` because that is
 * honestly what came off the wire; every row narrows what it needs and says so.
 */
interface AdvertisedTool {
  readonly name: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
}

/** A `tools/list` answer: the fingerprint of the response, plus whatever tools
 * could be read out of it. `tools` is EMPTY when nothing could be read — never
 * a throw, so a row fails on its own assertion rather than inside a helper. */
interface Advertisement {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
  readonly tools: readonly AdvertisedTool[];
}

async function readAdvertisement(): Promise<Advertisement> {
  const print = await fingerprint(
    await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps()),
  );
  return { ...print, tools: advertisedToolsIn(print.body) };
}

/**
 * The tools out of a raw response body.
 *
 * The `data:` payload comes out of the SSE frame by the fixture's
 * string-operations-only extractor; the parse starts at the JSON-RPC message.
 * Anything that is not a one-message SSE frame carrying a `result.tools` array
 * yields `[]`, which every row below asserts against explicitly.
 */
function advertisedToolsIn(body: string): readonly AdvertisedTool[] {
  const payloads = sseDataLines(body);
  if (payloads.length !== 1) {
    return [];
  }

  let message: unknown;
  try {
    message = JSON.parse(payloads[0] as string);
  } catch {
    return [];
  }

  const tools = asRecord(asRecord(message)?.result)?.tools;
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.flatMap((entry): readonly AdvertisedTool[] => {
    const tool = asRecord(entry);
    if (tool === null || typeof tool.name !== "string") {
      return [];
    }
    return [{ name: tool.name, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }];
  });
}

/** A plain JSON object, or `null` for anything else — including an array,
 * which JSON Schema never uses at a document root and which `typeof` would
 * otherwise call an object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toolNamed(ad: Advertisement, name: string): AdvertisedTool | undefined {
  return ad.tools.find((tool) => tool.name === name);
}

/**
 * The advertised `required` list — `[]` when the key is absent.
 *
 * ⚠️ THE `?? []` IS LOAD-BEARING AND WAS MEASURED INTO EXISTENCE. `W0-P4` found
 * that the SDK OMITS `required` ENTIRELY for a tool with no required properties
 * (`list_open_fixes`), so `expect(doc.required).not.toContain("limit")` throws
 * on `undefined` and fails the row for the wrong reason. It cannot assume
 * absence either — `get_fix` renders `["fixId"]` and `get_finding` renders
 * `["findingId"]`, and `WIRE-J2` pins both as its contrast.
 */
function requiredOf(document: Record<string, unknown> | null): readonly string[] {
  const required = document?.required ?? [];
  return Array.isArray(required) ? required.map((entry) => String(entry)) : [];
}

/**
 * Every forbidden key found anywhere under `value`, reported with the path it
 * was found at so a failure names the offender rather than only its existence.
 *
 * RECURSIVE OVER OBJECTS AND ARRAYS BOTH: a JSON Schema nests through
 * `properties`, `items`, `anyOf`, `$defs` and more, and a leak that only showed
 * up two levels down would be invisible to a shallow key check.
 */
function forbiddenKeysIn(value: unknown, path = "$"): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenKeysIn(entry, `${path}[${index}]`));
  }

  const record = asRecord(value);
  if (record === null) {
    return [];
  }

  const found: string[] = [];
  for (const [key, nested] of Object.entries(record)) {
    if ((FORBIDDEN_SCHEMA_KEYS as readonly string[]).includes(key)) {
      found.push(`${path}.${key}`);
    }
    found.push(...forbiddenKeysIn(nested, `${path}.${key}`));
  }
  return found;
}

/** Every advertised document in one list — three input schemas and three
 * output schemas — for the rows that make the same claim about all six. */
function everyDocument(ad: Advertisement): readonly (Record<string, unknown> | null)[] {
  return ad.tools.flatMap((tool) => [asRecord(tool.inputSchema), asRecord(tool.outputSchema)]);
}

function advertisedNames(ad: Advertisement): readonly string[] {
  return ad.tools.map((tool) => tool.name);
}

// ---------------------------------------------------------------------------
// WIRE-J1
// ---------------------------------------------------------------------------

describe("WIRE-J1 — every tool advertises an input schema that is a JSON Schema object and never null", () => {
  test("should advertise a non-null object with a type of object for each of the three tools", async () => {
    const ad = await readAdvertisement();

    // NON-VACUITY FIRST, IN EVERY ROW IN THIS FILE. An unreadable
    // advertisement yields an empty list, and "every tool in an empty list
    // advertises an object" is true and worthless.
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    for (const tool of ad.tools) {
      const document = asRecord(tool.inputSchema);
      expect(document).not.toBeNull();
      expect(document?.type).toBe("object");
    }
  });
});

// ---------------------------------------------------------------------------
// WIRE-J2
// ---------------------------------------------------------------------------

describe("WIRE-J2 — the list input schema is advertised with io input semantics, so a zero-argument call is legal", () => {
  test("should not name limit in required and should carry the default at properties.limit.default", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    const document = asRecord(toolNamed(ad, MCP_TOOL.LIST_OPEN_FIXES)?.inputSchema);
    expect(document).not.toBeNull();

    // THE WHOLE POINT OF THE ROW. `limit` is `.default(...)` with no
    // `.optional()` (`packages/shared/src/mcp/types.ts:308-315`). Rendered
    // INPUT-side it is optional-with-a-default; rendered OUTPUT-side it would
    // be REQUIRED, and a strict client would then refuse the zero-argument
    // call `WIRE-R16` and `WIRE-E3` both depend on. `W0-P4` measured
    // input-side, so D-5's adapter contingency does not fire.
    expect(requiredOf(document)).not.toContain("limit");

    const properties = asRecord(document?.properties);
    expect(properties).not.toBeNull();
    expect(asRecord(properties?.limit)?.default).toBe(LIST_OPEN_FIXES_DEFAULT_ITEMS);
  });

  test("should still advertise the required key where a tool genuinely has one", async () => {
    // THE CONTRAST HALF, AND IT IS NOT DECORATION. `requiredOf` coerces an
    // absent `required` to `[]`; without this half, a rendering that dropped
    // `required` from EVERY tool would satisfy the assertion above while
    // silently making both id-taking tools callable with no arguments.
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    expect(requiredOf(asRecord(toolNamed(ad, MCP_TOOL.GET_FIX)?.inputSchema))).toEqual(["fixId"]);
    expect(requiredOf(asRecord(toolNamed(ad, MCP_TOOL.GET_FINDING)?.inputSchema))).toEqual([
      "findingId",
    ]);
  });
});

// ---------------------------------------------------------------------------
// WIRE-J3
// ---------------------------------------------------------------------------

describe("WIRE-J3 — no advertised schema carries the standard-schema key", () => {
  test("should find no standard-schema, _def or parse key anywhere in the six advertised documents", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    // Six documents, walked whole. Reported as a list of PATHS so a failure
    // says where the leak is, not merely that there is one.
    expect(forbiddenKeysIn(everyDocument(ad))).toEqual([]);
  });

  test("should not carry the standard-schema marker in the raw response text either", async () => {
    // The walk above is over parsed KEYS, which is the claim. This is the
    // cheaper cross-check on the same fact one layer out: if a Zod object had
    // been serialised into the frame at all, its most distinctive key would be
    // in the bytes. Only `~standard` is checked as raw text — `_def` and
    // `parse` are ordinary enough substrings that a description could contain
    // one and fail this for a reason that is not a leak.
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    expect(ad.body).not.toContain("~standard");
  });

  test("should find a planted standard-schema key, so the walker cannot pass by going blind", async () => {
    // NON-VACUITY FOR THE WALKER ITSELF. A scanner that has stopped scanning
    // passes forever, and this file's whole guarantee rests on this function.
    const planted = forbiddenKeysIn({
      tools: [{ name: "control", inputSchema: { properties: { id: { "~standard": {} } } } }],
    });

    expect(planted).toEqual(["$.tools[0].inputSchema.properties.id.~standard"]);
    expect(forbiddenKeysIn({ nested: { deeply: { _def: {} } } })).toEqual(["$.nested.deeply._def"]);
    expect(forbiddenKeysIn({ nested: { parse: () => undefined } })).toEqual(["$.nested.parse"]);
  });
});

// ---------------------------------------------------------------------------
// WIRE-J4
// ---------------------------------------------------------------------------

describe("WIRE-J4 — registering every tool with its shared Zod schemas does not throw", () => {
  test("should build the handler, register all three tools with both schemas, and answer tools/list", async () => {
    // ⚠️ THIS IS THE ROW THAT WOULD HAVE CAUGHT THE MEASURED FAILURE. Handing
    // `registerTool` a hand-built JSON Schema throws
    // `TypeError: inputSchema/outputSchema/argsSchema must be a Standard Schema`
    // inside `normalizeRawShapeSchema` — the probe result that struck D-5. A
    // throw during registration reaches `server.ts`'s one catch and comes back
    // as `UNAVAILABLE`, so this row asserts BOTH that a real catalogue arrived
    // and that our own fault sentence did not.
    const ad = await readAdvertisement();

    expect(ad.status).toBe(200);
    expect(ad.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(ad.body).not.toContain(UNAVAILABLE.message);

    expect(ad.tools).toHaveLength(3);
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    // Registered with BOTH schemas, which is the half of the claim a name
    // check alone would miss.
    for (const tool of ad.tools) {
      expect(asRecord(tool.inputSchema)).not.toBeNull();
      expect(asRecord(tool.outputSchema)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// WIRE-J5
// ---------------------------------------------------------------------------

describe("WIRE-J5 — the advertised dialect is draft 2020-12 and needs no conversion", () => {
  test("should name draft 2020-12 in every advertised document's $schema", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    // ⚠️ MEASUREMENT NOTE FOR WAVE 8. `W0-P4` printed the INPUT documents
    // verbatim — `"$schema":"https://json-schema.org/draft/2020-12/schema"` —
    // and reported the OUTPUT documents only by root `type`. Both sides render
    // through the same Zod v4 path, so the claim is made about all six; if the
    // three output documents turn out to omit `$schema`, that is a real finding
    // about the renderer and not a reason to weaken this row to three.
    const documents = everyDocument(ad);
    expect(documents).toHaveLength(6);

    for (const document of documents) {
      expect(document).not.toBeNull();
      expect(String(document?.$schema)).toContain(EXPECTED_DIALECT);
    }
  });
});

// ---------------------------------------------------------------------------
// WIRE-J6
// ---------------------------------------------------------------------------

describe("WIRE-J6 — every tool advertises an output schema the client can validate against", () => {
  test("should advertise a non-null object output schema with an object root for all three tools", async () => {
    // ⚠️ THE EXCLUSION SET IS EMPTY, AND THAT IS A MEASURED RESULT RATHER THAN
    // AN OVERSIGHT. The ADD pre-authorised excluding any tool whose output
    // schema would not render; `W0-P4` registered all six shared schemas and
    // nothing threw, so all three tools are here and no tool is skipped. Round
    // 1's "for any excluded tool, `outputSchema` is absent" clause is vacuous
    // and is dropped rather than left implying an exclusion exists.
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    for (const tool of ad.tools) {
      const document = asRecord(tool.outputSchema);
      expect(document).not.toBeNull();

      // THE ROOT `type`, AND IT WAS A LIVE RISK. `fixSpecEnvelopeSchema` and
      // `getFindingOutputSchema` are typed `z.ZodType` rather than
      // `z.ZodObject`, so a non-object root was possible — which would have put
      // the SDK's non-object-root wrap path in play and changed the shape of
      // every `structuredContent` D-15 requires. Measured: all three render an
      // object root, so that path is never exercised.
      expect(document?.type).toBe("object");
    }
  });

  test("should advertise an output schema for the list tool that names its two required halves", async () => {
    // The one output document whose shape is load-bearing beyond its existence:
    // `WIRE-E3`/`WIRE-E9` require a non-error `list_open_fixes` result to carry
    // `structuredContent` valid against THIS document, and a real client
    // compiles its validator from exactly these bytes. If `fixes` and `window`
    // are not both required here, the -32600 the client throws stops being
    // reachable and the D-15 guard loses its teeth.
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    const document = asRecord(toolNamed(ad, MCP_TOOL.LIST_OPEN_FIXES)?.outputSchema);
    expect(document).not.toBeNull();
    expect(requiredOf(document).toSorted()).toEqual(["fixes", "window"]);
  });
});
