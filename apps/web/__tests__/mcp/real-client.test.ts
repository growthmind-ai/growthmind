// THE NORTH STAR, PROVEN BY A REAL MCP CLIENT — WIRE-E1…E9 (O-013, lane
// W0-T-D).
//
// "A stock MCP client connects to the deployed surface and calls all three
// tools, with refusals byte-identical to today." Every other file in this
// directory drives our own `Request` objects into our own handler and asserts
// on our own `Response` objects. That proves the surface answers what we think
// it answers. It cannot prove the one thing this sprint exists for: that a
// program NOBODY HERE WROTE can talk to it. This file is the only one that
// does, and it is the DoD clause O-009 failed.
//
// ===========================================================================
// WHAT IS REAL HERE, AND THE ONE THING THAT IS NOT (D-10)
// ===========================================================================
//
// REAL: a genuine `@modelcontextprotocol/client@2.0.0` `Client`, its genuine
// `StreamableHTTPClientTransport`, its genuine `initialize` handshake, its
// genuine JSON-RPC serialisation, its genuine `tools/list` parser, and its
// genuine compiled output validators. Our REAL exported request handler answers
// every one of those, and — in the `WIRE-E6` block — a REAL `gmak_` credential
// minted into a REAL `api_keys` row on a REAL database.
//
// NOT REAL: the socket. The transport's `fetch` is injected and calls the
// handler in-process, so no port is bound, no listener runs and no server is
// started. WE THEREFORE PROVE PROTOCOL CONFORMANCE, NOT HTTP-STACK CONFORMANCE.
// A real socket with a real Claude Code CLI against a deployed URL is
// `tasks/mcp-wire-protocol/operator-acceptance.md` (task 9.2), and it is not
// something a test in this repository can stand in for. Saying so here is the
// honest version; quietly asserting "a client connects" and meaning "in
// process" is not.
//
// The arrangement was measured green inside the plain `bun test` gate
// (`W0-P3′`): default discovery picks this file up, and the injected `fetch`
// coexists with the process-stash database seam. `mock.module` is neither used
// nor needed — a stash is a VALUE production code reads and an injected `fetch`
// is a CONSTRUCTOR OPTION, so neither touches the module registry and the O-006
// pollution class cannot arise.
//
// ---------------------------------------------------------------------------
// THE ONE DEFECT THAT NO HANDLER-ONLY TEST CAN SEE (D-15)
// ---------------------------------------------------------------------------
//
// A tool that advertises an `outputSchema` MUST return schema-valid
// `structuredContent` on every non-error result. THE SERVER DOES NOT ENFORCE
// THIS: a raw POST with no `structuredContent` comes back 200 in silence. The
// CLIENT enforces it, from validators it compiled out of the `tools/list`
// response — so `client.callTool` rejects with `ProtocolError -32600` and the
// agent gets nothing. Measured, on the first run of the probe that found it.
//
// Two consequences this file is built around:
//   1. `listTools()` BEFORE `callTool()`, always. A client that has never
//      listed skips the check entirely, so a real-client test that calls
//      without listing is testing a path no client takes. `WIRE-E8` pins the
//      ordering; its second half exists to show what the un-ordered version
//      would have "proven".
//   2. `isError: true` results are EXEMPT from the check, which is why every
//      refusal path (`NOT_FOUND`, unknown tool, malformed input, `UNAVAILABLE`)
//      is safe and why every earlier probe passed without noticing.
//      `WIRE-E9(c)` pins that exemption so nobody "fixes" it away.
//
// ---------------------------------------------------------------------------
// BOTH ERAS, ONE HANDLER (D-2)
// ---------------------------------------------------------------------------
//
// The transport serves the legacy (`2025-11-25` handshake) and modern
// (`2026-07-28` discovery) eras from one handler, and there is no switch that
// turns either off. A stock `new Client({name, version})` with NO options
// negotiates LEGACY — measured — so `WIRE-E1…E6` exercise the leg the north
// star actually depends on, and `WIRE-E7` drives the modern leg against THE
// SAME handler and the same deps object, which is what makes it a both-eras
// proof rather than two unrelated tests.
//
// ⚠️ AN HONEST SHORTFALL, ENCODED RATHER THAN ENGINEERED AROUND. Our 401's
// BYTES are identical on both legs — it is produced before the SDK is in the
// call stack. But on the MODERN leg the client's negotiation probe replaces our
// sentence with its own (`Version negotiation failed: the server requires
// authorization (HTTP 401)`), so "errors instruct rather than report" degrades
// at `connect()` there. It is the client's text in the client's code and there
// is nothing to fix. It does not touch `WIRE-E6`, which is a `tools/call` and
// not a `connect`.
//
// ---------------------------------------------------------------------------
// IMPORT FROM THE PACKAGE ROOT
// ---------------------------------------------------------------------------
//
// There is NO `@modelcontextprotocol/client/streamableHttp` subpath. That is v1
// muscle memory and it fails at import with `Cannot find module`. `client@2.0.0`
// exports exactly `.`, `./stdio`, `./validators/ajv` and `./validators/cf-worker`
// — every transport is on the ROOT export.
//
// And the era accessor is `client.getProtocolEra()`, A METHOD. The property
// `client.protocolEra` is `undefined`, so a row written against the property
// asserts nothing at all while looking like it asserts everything.
//
// ---------------------------------------------------------------------------
// GREEN, AND WHAT THAT MEANS HERE
// ---------------------------------------------------------------------------
//
// These rows were authored red, before `wire.ts` existed: `server.ts` read a
// pre-protocol `{tool, input}` envelope, so a real client's `initialize`
// arrived as a body with no `tool` key and came back HTTP 400. That is history.
// Waves 7–8 landed, and every row in this file passes.
//
// WHAT STILL HAS TO BE TRUE, now that nothing here is waiting on an
// implementation: a row that goes red is a REGRESSION and not an unfinished
// feature, and the failure to reach for first is the SDK-behaviour note the row
// carries rather than a missing handler. The `⚠️` blocks below are the
// measurements; they are what a debugging session should start from.
//
// Lane prefix `mcpe`.
import { createApiKeysRepo } from "@growthmind/db";
import {
  MCP_TOOL,
  MCP_TOOL_NAMES,
  fixSpecEnvelopeSchema,
  listOpenFixesOutputSchema,
  type TenantContext,
} from "@growthmind/shared";
import {
  Client,
  ProtocolError,
  SdkHttpError,
  StreamableHTTPClientTransport,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
  type ClientOptions,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GET, POST } from "../../app/api/mcp/route";
import { NOT_FOUND, UNAUTHENTICATED } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  MCP_PROTOCOL_ERA_TARGET,
  MCP_PROTOCOL_LEGACY_FLOOR,
  JSON_RPC_ERROR_CODE,
} from "../../lib/mcp/wire-constants";
import {
  buildTestTenantContext,
  createTestOrganization,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "../tenancy/helpers/auth-fixture";
import {
  fakeCredentials,
  fakeReadPort,
  findingRecordFor,
  fixRecordFor,
  mintRealApiKey,
  openFixRowFor,
  sseDataLines,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";

/** Where the transport thinks it is talking to. Nothing resolves this host and
 * nothing tries: the injected `fetch` never leaves the process, and an
 * unroutable name makes that impossible to get wrong by accident. */
const MCP_ENDPOINT = new URL("https://real-client.invalid/api/mcp");

/** Who this client says it is. A real client sends a name and a version and
 * nothing else is required. */
const CLIENT_INFO = { name: "growthmind-real-client-test", version: "0.0.0" } as const;

/**
 * What `list_open_fixes` must answer with while no `findings` table exists —
 * a truthful empty WITH its denominators, not an absent answer.
 *
 * ⚠️ THIS OBJECT IS THE D-15 CONTRACT, not a convenience. On the probe's first
 * run the call threw `ProtocolError -32600: Tool list_open_fixes has an output
 * schema but did not return structured content`; returning exactly this turned
 * it green. If `wire.ts` omits or mis-shapes it, the north star's "calls all
 * three tools" fails on the ONE tool with a non-error answer.
 */
const EMPTY_LIST_STRUCTURED_CONTENT = {
  fixes: [],
  window: { returned: 0, totalOpen: 0, truncated: false },
} as const;

/** Ids nobody ever issued — shaped like real ones, so a refusal is never
 * accidentally about the shape of the argument. */
const NEVER_ISSUED_FIX = "fix-mcpe-never-issued";
const NEVER_ISSUED_FINDING = "finding-mcpe-never-issued";

/**
 * ONE handler, ONE deps object, shared by every row outside the `WIRE-E6`
 * block.
 *
 * `WIRE-E7`'s claim is that the MODERN leg is served by THE SAME handler
 * `WIRE-E1` drove — that is what makes it a both-eras proof rather than two
 * unrelated tests — so the deps must be a single module-scope value and not a
 * per-test factory that happens to build the same thing.
 *
 * The credential source is the fixture's fake and the store is EMPTY, both on
 * purpose: none of these rows is about the credential store (that is
 * `WIRE-E6`'s job, with a real minted key) and none is about data (the empty
 * answer IS the answer this branch has). The read port a deployed instance uses
 * is the absent one, which answers exactly the same way.
 */
const FAKE_DEPS: McpServerDeps = {
  credentials: fakeCredentials({ [KEY_A]: ORG_A }),
  reads: fakeReadPort().port,
};

/** How a request gets answered. The two implementations are the real exported
 * handler with fake deps, and the real mounted route over a real database. */
type Serve = (request: Request) => Promise<Response>;

const serveReal: Serve = (request) => handleMcpRequest(request, FAKE_DEPS);

/** The MOUNTED route, dispatched by verb the way Next.js dispatches it. The
 * transport opens a speculative `GET`, so a wire that sent everything to `POST`
 * would be testing a route shape that does not exist. */
const serveMounted: Serve = (request) => (request.method === "POST" ? POST(request) : GET(request));

// ---------------------------------------------------------------------------
// The transport seam
// ---------------------------------------------------------------------------

/** One request the client made and the answer it got. Recorded so `WIRE-E1`
 * can assert the SHAPE of a handshake rather than only its outcome. */
interface Exchange {
  readonly method: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

interface ClientWire {
  readonly fetch: FetchLike;
  readonly exchanges: readonly Exchange[];
}

/**
 * A `fetch` that answers out of this process, recording every exchange.
 *
 * `rewrite` is the negative-control seam and nothing else: it receives the
 * response body a real handler produced and returns the body the client will
 * actually see. `WIRE-E8`'s vacuous half and `WIRE-E9(b)` are the only two
 * users, and both hand it `withoutStructuredContent` — which is how a "handler
 * that forgot `structuredContent`" is built without a second handler existing.
 *
 * `content-length` is dropped from the re-issued response: a rewritten body is
 * a different length, and a stale length header truncates it.
 */
function wireTo(serve: Serve, rewrite?: (body: string) => string): ClientWire {
  const exchanges: Exchange[] = [];

  const injected: FetchLike = async (url, init) => {
    const request = new Request(url, init);
    const method = request.method;

    const served = await serve(request);
    const body = await served.text();
    exchanges.push({
      method,
      status: served.status,
      contentType: served.headers.get("content-type"),
      body,
    });

    const shown = rewrite === undefined ? body : rewrite(body);
    const headers = new Headers(served.headers);
    headers.delete("content-length");

    return new Response(shown.length === 0 ? null : shown, {
      status: served.status,
      statusText: served.statusText,
      headers,
    });
  };

  return { fetch: injected, exchanges };
}

const STRUCTURED_CONTENT_KEY = "structuredContent";

/**
 * The same answer the real handler produced, with `structuredContent` taken out
 * of the result and NOTHING ELSE TOUCHED.
 *
 * This is the negative control D-15 needs: a "server that advertises an output
 * schema and then does not honour it", built by removing one key rather than by
 * writing a second handler that could drift from the first. Bodies that never
 * carried the key — the `initialize` answer, the `202` notification answer, the
 * `tools/list` catalogue, every `isError` refusal — pass through untouched.
 */
function withoutStructuredContent(body: string): string {
  if (!body.includes(`"${STRUCTURED_CONTENT_KEY}"`)) {
    return body;
  }

  const payloads = sseDataLines(body);
  const framed = payloads.length === 1;
  const source = framed ? (payloads[0] as string) : body;

  const message = JSON.parse(source) as { result?: Record<string, unknown> };
  if (message.result !== undefined) {
    delete message.result[STRUCTURED_CONTENT_KEY];
  }

  const stripped = JSON.stringify(message);
  return framed ? `event: message\ndata: ${stripped}\n\n` : stripped;
}

function transportFor(wire: ClientWire, key: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: wire.fetch,
    // How a person actually wires a credential into a stock client: one header
    // on every request. Nothing here knows what a `gmak_` is.
    requestInit: { headers: { authorization: `Bearer ${key}` } },
  });
}

/** A connected client. `options` is passed straight through, so the rows that
 * must use NO `ClientOptions` at all simply do not pass any. */
async function openClient(wire: ClientWire, key: string, options?: ClientOptions): Promise<Client> {
  const client = new Client(CLIENT_INFO, options);
  await client.connect(transportFor(wire, key));
  return client;
}

/**
 * One macrotask turn.
 *
 * `connect()`'s third request — the speculative `GET` — is opened without being
 * awaited by `connect()` itself, so a read of the exchange list the instant
 * `connect()` resolves can miss it and turn a correct handshake into a flake.
 * Same discipline as `./helpers/wire-probes.ts`'s rejection watcher.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The text of a result's first content block, or `undefined` when there is no
 * text block to read — never a throw inside a helper, so a row fails on its own
 * assertion. */
function firstText(result: CallToolResult): string | undefined {
  const block = result.content[0];
  if (block === undefined || block.type !== "text") {
    return undefined;
  }
  return block.text;
}

/** Whatever `run` rejected with. Fails the row if it did not reject at all,
 * which is the failure mode a bare `try/catch` silently allows. */
async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("mcpe: expected the call to reject, and it resolved");
}

async function closeQuietly(client: Client): Promise<void> {
  await client.close();
}

// ===========================================================================
// WIRE-E1…E5, E7, E8, E9 — one handler, no database
// ===========================================================================

describe("a real MCP client against the real exported handler", () => {
  // -------------------------------------------------------------------------
  // WIRE-E1
  // -------------------------------------------------------------------------

  test("WIRE-E1 — should complete the legacy initialize handshake with no client options at all", async () => {
    const wire = wireTo(serveReal);

    // ⚠️ NO `ClientOptions` — NOT `{ versionNegotiation: { mode: 'legacy' } }`.
    // The claim is about what a STOCK client does out of the box, and a client
    // told which era to use would prove only that we can configure one.
    const client = new Client(CLIENT_INFO);

    try {
      await client.connect(transportFor(wire, KEY_A));

      // The accessor is a METHOD. `client.protocolEra` is `undefined` and a row
      // written against the property asserts nothing.
      expect(client.getProtocolEra()).toBe("legacy");

      // Pinned by version string, unlike the modern era: this one IS
      // negotiated, so a package upgrade that moved the list would move what
      // this server answers.
      expect(client.getNegotiatedProtocolVersion()).toBe(MCP_PROTOCOL_LEGACY_FLOOR);
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(MCP_PROTOCOL_LEGACY_FLOOR);

      // ⚠️ `connect()` ISSUES THREE REQUESTS, NOT ONE. Measured. A reviewer who
      // expects one will read the extra two as a bug; they are the handshake.
      await flush();
      expect(wire.exchanges).toHaveLength(3);

      const posts = wire.exchanges.filter((exchange) => exchange.method === "POST");
      const gets = wire.exchanges.filter((exchange) => exchange.method === "GET");
      expect(posts).toHaveLength(2);
      expect(gets).toHaveLength(1);

      // 1. `initialize` — answered by the SDK, SSE-framed under the pinned
      //    `responseMode: "sse"`.
      expect(posts[0]?.status).toBe(200);
      expect(posts[0]?.contentType).toBe("text/event-stream");

      // 2. `notifications/initialized` — 202, EMPTY BODY, and `content-type` is
      //    `null` rather than a string. Any sweep in this file over "every
      //    response's content-type" must tolerate that or it fails on a
      //    correct handshake.
      expect(posts[1]?.status).toBe(202);
      expect(posts[1]?.contentType).toBeNull();
      expect(posts[1]?.body).toBe("");

      // 3. A SPECULATIVE `GET`, which our route answers 405 with the
      //    re-authored `WRONG_METHOD` sentence. The SDK never sees it. This is
      //    HAPPY PATH, not an edge case: it happens on every successful
      //    connect.
      expect(gets[0]?.status).toBe(405);
    } finally {
      await closeQuietly(client);
    }
  });

  // -------------------------------------------------------------------------
  // WIRE-E2
  // -------------------------------------------------------------------------

  test("WIRE-E2 — should list exactly three tools, each with an input schema its own parser accepted", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      // THE CALL RESOLVING IS HALF THE ASSERTION. The client parses every
      // advertised `inputSchema` and compiles a validator from it; a document
      // it cannot read makes this reject rather than return something odd.
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);

      expect(names).toEqual([...MCP_TOOL_NAMES]);

      for (const tool of listed.tools) {
        expect(tool.inputSchema).not.toBeNull();
        expect(typeof tool.inputSchema).toBe("object");
      }

      // ABSENT BY NAME, not by count. The draft contract's one WRITE tool must
      // never appear on a surface whose whole promise is that it only reads,
      // and a length check would not notice a swap.
      expect(names).not.toContain("report_shipped");
    } finally {
      await closeQuietly(client);
    }
  });

  // -------------------------------------------------------------------------
  // WIRE-E3
  // -------------------------------------------------------------------------

  test("WIRE-E3 — should call list_open_fixes and receive a truthful empty with its denominators", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      // LIST FIRST. This is what compiles the output validator, and it is what
      // every real client does. See `WIRE-E8`.
      await client.listTools();

      // The zero-argument call, confirmed legal through a real client rather
      // than only through the advertised document (`WIRE-J2`, `WIRE-R16`).
      const result = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });

      // ⚠️ ITS RESOLUTION IS THE ASSERTION. If `wire.ts` returns no
      // `structuredContent`, this line is never reached — the client throws
      // -32600 first, and the north star fails on the one tool with a non-error
      // answer.
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(EMPTY_LIST_STRUCTURED_CONTENT);
    } finally {
      await closeQuietly(client);
    }
  });

  // -------------------------------------------------------------------------
  // WIRE-E4 / WIRE-E5
  // -------------------------------------------------------------------------

  test("WIRE-E4 — should receive the frozen not-found from get_fix as a tool execution error", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });

      // `isError: true` ON AN HTTP 200, never a JSON-RPC error object: "there
      // is nothing here with that id" is business logic, and a refusal sent as
      // a protocol error is one a client may render as a transport failure —
      // which puts our sentence somewhere the model never reads it.
      expect(result.isError).toBe(true);

      // BYTE FOR BYTE against the frozen constant, through a foreign client's
      // own deserialiser. This is the "refusals byte-identical to today" half
      // of the north star, and it is the only place it is proven end to end.
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E5 — should receive the identical not-found from get_finding, byte-identical to get_fix's", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const finding = await client.callTool({
        name: MCP_TOOL.GET_FINDING,
        arguments: { findingId: NEVER_ISSUED_FINDING },
      });
      const fix = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });

      expect(finding.isError).toBe(true);
      expect(firstText(finding)).toBe(NOT_FOUND.message);

      // THE TWO TOOLS' REFUSALS ARE THE SAME STRING. One frozen constant, one
      // producer — so an id that does not exist tells an agent nothing about
      // WHICH kind of thing it failed to find, on either tool. The cross-tenant
      // proof one layer up rests on exactly this property.
      expect(firstText(finding)).toBe(firstText(fix) as string);
    } finally {
      await closeQuietly(client);
    }
  });

  // -------------------------------------------------------------------------
  // WIRE-E7
  // -------------------------------------------------------------------------

  test("WIRE-E7 — should let a client pinned to the modern era connect and list the same three tools", async () => {
    // ⚠️ UN-INVERTED, AND THIS IS THE ROW THAT FLIPPED. Round 1 asserted the
    // OPPOSITE — that a modern-pinned client is refused — on a probe that sent
    // a claim-less POST, which classifies LEGACY, where `-32601` is the correct
    // answer. The modern leg answers `server/discover` and names
    // `2026-07-28`. Both eras are served by one handler and there is no
    // modern-off switch in the SDK's options, so "the modern era is not served"
    // was never a claim we could make true. Do not re-invert this.
    const wire = wireTo(serveReal);

    // `{ pin }` HAS NO FALLBACK. A server that stopped offering `2026-07-28`
    // turns this red immediately rather than quietly downgrading — which is the
    // whole reason the modern era is pinned by BEHAVIOUR and never by a version
    // string in a negotiation list.
    const client = await openClient(wire, KEY_A, {
      versionNegotiation: { mode: { pin: MCP_PROTOCOL_ERA_TARGET } },
    });

    try {
      expect(client.getProtocolEra()).toBe("modern");

      // ⚠️ BY FIELD, NEVER BY FRAME (D-6 rule 2). The modern result carries
      // `resultType:"complete"` and `_meta.serverInfo` that the legacy frame
      // lacks, so a literal body comparison here would be asserting the other
      // leg's bytes. Every literal-frame row in this sprint is authored against
      // the legacy leg for exactly that reason.
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual([...MCP_TOOL_NAMES]);

      // A tool call, too — connecting and listing on the modern leg would not
      // prove the leg can answer work.
      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E7 — should serve both eras from the same handler, interleaved, with no interference", async () => {
    // THE PAIRED HALF, and what makes `WIRE-E7` a both-eras proof rather than
    // two unrelated tests: four clients, alternating legs, against the ONE
    // `FAKE_DEPS` every row in this describe shares.
    const wire = wireTo(serveReal);
    const modern: ClientOptions = {
      versionNegotiation: { mode: { pin: MCP_PROTOCOL_ERA_TARGET } },
    };

    const clients = [
      await openClient(wire, KEY_A),
      await openClient(wire, KEY_A, modern),
      await openClient(wire, KEY_A),
      await openClient(wire, KEY_A, modern),
    ];

    try {
      expect(clients.map((client) => client.getProtocolEra())).toEqual([
        "legacy",
        "modern",
        "legacy",
        "modern",
      ]);

      for (const client of clients) {
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        expect(names).toEqual([...MCP_TOOL_NAMES]);
      }
    } finally {
      for (const client of clients) {
        await closeQuietly(client);
      }
    }
  });

  // -------------------------------------------------------------------------
  // WIRE-E8
  // -------------------------------------------------------------------------

  test("WIRE-E8 — should exercise the success path the way every real client does: list first, then call", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      // THE ORDERING IS THE ROW. `listTools()` is what makes the client compile
      // an output validator for each tool; `callTool()` is what runs it. This
      // is the only sequence a stock client ever performs, so it is the only
      // sequence that tests production behaviour.
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(EMPTY_LIST_STRUCTURED_CONTENT);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E8 — should resolve a deliberately broken result when the client never listed first, which proves nothing", async () => {
    // ⚠️ THIS HALF IS VACUOUS ON PURPOSE, AND IT IS KEPT FOR EXACTLY THAT
    // REASON. The wire below strips `structuredContent` out of every result —
    // the same defect `WIRE-E9(b)` catches — and the call STILL RESOLVES,
    // because a client that has never called `tools/list` has no compiled
    // validator and skips the check entirely. Measured: `listTools-first=NO`
    // resolved for all three tools even with a deliberately broken result.
    //
    // SO: A REAL-CLIENT TEST THAT CALLS WITHOUT LISTING PROVES NOTHING ABOUT
    // THE CONTRACT. It would have passed on the broken implementation the probe
    // found. This row's whole job is to make that visible, so nobody
    // "simplifies" the `listTools()` line out of `WIRE-E3` or `WIRE-E9` on the
    // grounds that it looks redundant.
    const wire = wireTo(serveReal, withoutStructuredContent);
    const client = await openClient(wire, KEY_A);

    try {
      const result = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      // No `structuredContent` at all, and the client did not care.
      expect(result.structuredContent).toBeUndefined();
    } finally {
      await closeQuietly(client);
    }
  });

  // -------------------------------------------------------------------------
  // WIRE-E9
  // -------------------------------------------------------------------------

  test("WIRE-E9(a) — should return structured content that satisfies the advertised output schema", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });

      // Parsed through OUR schema as well as the client's compiled validator.
      // The client proves a foreign program accepts it; this proves it is the
      // same shape `packages/shared` declares, so the two can never drift into
      // "the client is happy and we are serving something else".
      const parsed = listOpenFixesOutputSchema.safeParse(result.structuredContent);
      expect(parsed.success ? parsed.data : parsed.error.issues).toEqual(
        EMPTY_LIST_STRUCTURED_CONTENT,
      );
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E9(b) — should make a real client reject a non-error result that omits structured content", async () => {
    // ⚠️ THE NEGATIVE CONTROL, AND THE ROW THAT GUARDS THE ONE DEFECT IN THIS
    // SPRINT THAT WOULD HAVE REACHED A CUSTOMER'S CODING AGENT. Without it,
    // `WIRE-E9(a)` could be passing because the client validates nothing.
    //
    // THE SERVER DOES NOT ENFORCE THIS. A raw POST with the same missing key
    // returns 200 in silence, so NO handler-only row can replace this one — it
    // is textbook D11: the value is advertised by one surface and required by
    // another, and only the consumer's real entry point proves the wire.
    const wire = wireTo(serveReal, withoutStructuredContent);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const error = await rejection(() =>
        client.callTool({ name: MCP_TOOL.LIST_OPEN_FIXES, arguments: {} }),
      );

      expect(ProtocolError.isInstance(error)).toBe(true);
      expect((error as ProtocolError).code).toBe(JSON_RPC_ERROR_CODE.INVALID_REQUEST);

      // Naming the tool, so an agent reading the rejection knows which call to
      // stop making rather than only that something went wrong.
      expect(String((error as ProtocolError).message)).toContain(MCP_TOOL.LIST_OPEN_FIXES);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E9(c) — should resolve an isError result that carries no structured content", async () => {
    // THE EXEMPTION, PINNED. Every refusal this surface has — `NOT_FOUND`, an
    // unknown tool, malformed arguments, `UNAVAILABLE` — travels as
    // `isError: true` with no `structuredContent`, and the client skips output
    // validation entirely for those. That is why every refusal path is safe,
    // why the earlier probes passed without noticing the defect, and why
    // `refusalToolResult` must never grow a `structuredContent` key "for
    // consistency".
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const result = await client.callTool({
        name: MCP_TOOL.GET_FINDING,
        arguments: { findingId: NEVER_ISSUED_FINDING },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });
});

// ===========================================================================
// WIRE-E10 — the two tools that have never answered a real record to a real
// client
// ===========================================================================
//
// ⚠️ THIS IS THE EXACT D11 CLASS THIS SPRINT ALREADY PAID FOR ONCE. `wire.ts`
// names it as a live obligation in as many words: `get_fix` and `get_finding`
// "only escape it today because they answer NOT_FOUND as execution errors, and
// execution errors are exempt; the moment they return a real record they
// inherit this line unchanged". Every row above seeds an EMPTY store, so
// `WIRE-E9(a)` exercises the structured-content contract on `list_open_fixes`
// and on nothing else — two of the three tools have never had a non-error
// answer validated by a foreign client's compiled validator, which is the only
// place the defect is visible at all. THE SERVER DOES NOT ENFORCE IT.
//
// A SEPARATE DEPS OBJECT, NOT A SEEDED `FAKE_DEPS`. Seeding the shared one
// would move `WIRE-E3`, `WIRE-E8` and `WIRE-E9(a)` off the empty answer they
// assert and `WIRE-E4`, `WIRE-E5`, `WIRE-E7` and `WIRE-E9(c)` off their
// refusals — sixty-nine contract rows do not get quietly rewritten to make a
// new one convenient. The store below is this block's alone.
//
// STILL NO DATABASE. The records come from the same fixture builders the
// handler suites use, parsed through their own schemas at construction, so a
// record this block can seed is a record the contract accepts.

const SEEDED_FIX_ID = "fix-mcpe-seeded";
const SEEDED_FINDING_ID = "finding-mcpe-seeded";
const SEEDED_RESULTS_BY = "2026-07-01T00:00:00.000Z";

const SEEDED_DEPS: McpServerDeps = {
  credentials: fakeCredentials({ [KEY_A]: ORG_A }),
  reads: fakeReadPort({
    openFixes: [
      {
        organizationId: ORG_A,
        projectId: "project-mcpe",
        row: openFixRowFor({
          fixId: SEEDED_FIX_ID,
          findingId: SEEDED_FINDING_ID,
          resultsBy: SEEDED_RESULTS_BY,
        }),
      },
    ],
    fixes: [
      {
        organizationId: ORG_A,
        record: fixRecordFor({
          fixId: SEEDED_FIX_ID,
          findingId: SEEDED_FINDING_ID,
          resultsBy: SEEDED_RESULTS_BY,
        }),
      },
    ],
    findings: [
      {
        organizationId: ORG_A,
        record: findingRecordFor({ findingId: SEEDED_FINDING_ID, fixId: SEEDED_FIX_ID }),
      },
    ],
  }).port,
};

const serveSeeded: Serve = (request) => handleMcpRequest(request, SEEDED_DEPS);

describe("a real MCP client reading real records out of a seeded store", () => {
  test("WIRE-E10 — should call all three tools through one listing client and have every result accepted", async () => {
    const wire = wireTo(serveSeeded);
    const client = await openClient(wire, KEY_A);

    try {
      // LIST FIRST, AS EVERYWHERE IN THIS FILE. This is what compiles the
      // output validators; without it the three calls below prove nothing at
      // all (`WIRE-E8`'s vacuous half says so in detail).
      await client.listTools();

      // ⚠️ EACH CALL RESOLVING IS THE ASSERTION. A result that omits or
      // mis-shapes `structuredContent` never reaches the lines below — the
      // client throws `ProtocolError -32600` first, exactly as `WIRE-E9(b)`
      // proves it does.
      const listed = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });
      const fix = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: SEEDED_FIX_ID },
      });
      const finding = await client.callTool({
        name: MCP_TOOL.GET_FINDING,
        arguments: { findingId: SEEDED_FINDING_ID },
      });

      // NOT REFUSALS. `isError` results are EXEMPT from output validation, so a
      // block that accidentally asked for ids nobody seeded would resolve
      // happily and assert nothing — this is the line that stops it.
      expect(listed.isError).toBeFalsy();
      expect(fix.isError).toBeFalsy();
      expect(finding.isError).toBeFalsy();

      // THE NORTH STAR'S "calls all three tools", with a real answer on each.
      expect(listed.structuredContent).not.toBeUndefined();
      expect(fix.structuredContent).not.toBeUndefined();
      expect(finding.structuredContent).not.toBeUndefined();
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E10 — should answer get_fix with a rendered spec valid against the schema it advertises", async () => {
    const wire = wireTo(serveSeeded);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: SEEDED_FIX_ID },
      });

      // Parsed through OUR schema as well as the client's compiled validator,
      // for the reason `WIRE-E9(a)` gives: the client proves a foreign program
      // accepts it, and this proves it is the same shape `packages/shared`
      // declares — so the two can never drift into "the client is happy and we
      // are serving something else".
      const parsed = fixSpecEnvelopeSchema.safeParse(result.structuredContent);
      if (!parsed.success) {
        throw new Error(`mcpe: get_fix answered a shape the contract refuses: ${parsed.error}`);
      }

      expect(parsed.data.fixId).toBe(SEEDED_FIX_ID);
      expect(parsed.data.findingId).toBe(SEEDED_FINDING_ID);
      // The join `call-tool.ts` performs in one line — the renderer's sentences,
      // reaching a real client rather than only a handler assertion.
      expect(parsed.data.specText.length).toBeGreaterThan(0);
      expect(parsed.data.dateIsFinal).toBe(true);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E10 — should answer get_finding with evidence a real client accepted", async () => {
    const wire = wireTo(serveSeeded);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.GET_FINDING,
        arguments: { findingId: SEEDED_FINDING_ID },
      });

      expect(result.isError).toBeFalsy();

      // `get_finding`'s output schema is reachable only through the descriptor
      // (`@growthmind/shared`'s barrel does not re-export it), so the assertion
      // here is on the fields rather than on a re-parse — the descriptor's own
      // schema already parsed this value inside `call-tool.ts`, and the client's
      // compiled validator accepted it, which is two independent checks.
      const structured = result.structuredContent as Record<string, unknown> | undefined;
      expect(structured?.findingId).toBe(SEEDED_FINDING_ID);
      expect(structured?.fixId).toBe(SEEDED_FIX_ID);
      expect(Array.isArray(structured?.evidence)).toBe(true);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E10 — should still refuse an id nobody seeded, from the same store", async () => {
    // NON-VACUITY FOR THE WHOLE BLOCK. A store that answered every id with the
    // one record it holds would pass all three rows above; this is what proves
    // the reads are resolving the id rather than returning whatever is there.
    const wire = wireTo(serveSeeded);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });

      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });
});

// ===========================================================================
// WIRE-E6 — the only block that needs a real credential, and the only one that
// pays for a database
// ===========================================================================
//
// `setupAuthTest()` costs about five seconds; every row above costs a couple of
// hundred milliseconds. The fixture therefore lives INSIDE this describe rather
// than at file scope, so the fast rows do not pay for the slow one. That is the
// only reason for the split.

describe("a real MCP client whose real credential is revoked mid-session", () => {
  const TEST_PASSWORD = "correct-horse-battery-staple";

  /** The stash `getDb()` reads (`apps/web/lib/db.ts`). A VALUE production code
   * already reads, never a patch of the module registry — `mock.module` is
   * banned in this directory and is not needed here. */
  const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

  let authCtx: AuthTestContext;
  let ownerCtx: TenantContext;
  /** Two REAL `gmak_` credentials in one organization. The second is the
   * non-vacuity half: it must still work after the first is revoked. */
  let revokedKey: string;
  let revokedKeyId: string;
  let liveKey: string;

  beforeAll(async () => {
    authCtx = await setupAuthTest();

    // Installed BEFORE the first request. `resolveMcpDeps()` calls `getDb()`
    // per request rather than at module load, so a static import of the route
    // above is correct and nothing had to be imported dynamically.
    globalForDb.__growthmindDb = authCtx.db;

    const owner = await signUpTestUser(authCtx.auth, {
      name: "Owner Mcpe",
      email: "owner-mcpe@example.com",
      password: TEST_PASSWORD,
    });
    const organization = await createTestOrganization(authCtx.db, {
      name: "Org Mcpe",
      ownerUserId: owner.id,
    });
    ownerCtx = await buildTestTenantContext(authCtx.db, {
      userId: owner.id,
      organizationId: organization.id,
    });

    const revoking = await mintRealApiKey(authCtx.db, ownerCtx, "agent-mcpe-revoked");
    revokedKey = revoking.raw;
    revokedKeyId = revoking.id;
    liveKey = (await mintRealApiKey(authCtx.db, ownerCtx, "agent-mcpe-live")).raw;

    // NON-VACUITY FOR THE WHOLE BLOCK: two genuinely different credentials.
    expect(revokedKey).not.toBe(liveKey);
  });

  afterAll(async () => {
    delete globalForDb.__growthmindDb;
    await authCtx.close();
  });

  test("WIRE-E6 — should refuse the very next call after the credential is revoked, with no restart", async () => {
    const wire = wireTo(serveMounted);
    const client = await openClient(wire, revokedKey);
    const pidBefore = process.pid;

    try {
      // BEFORE: the credential works. Without this half the 401 below could
      // mean the key never worked, which would prove nothing about revocation.
      //
      // Deliberately a refusal-shaped call (`get_fix` on an id nobody issued),
      // so this row stays about the CREDENTIAL and does not also depend on the
      // D-15 structured-content contract `WIRE-E3` owns.
      const before = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });
      expect(before.isError).toBe(true);
      expect(firstText(before)).toBe(NOT_FOUND.message);

      const revoked = await createApiKeysRepo(authCtx.db, ownerCtx).revoke(revokedKeyId);
      expect(revoked?.id).toBe(revokedKeyId);

      // THE VERY NEXT CALL, on the SAME connected client. Nothing caches a
      // credential, so revocation takes effect on the next request rather than
      // on the next deploy.
      const error = await rejection(() =>
        client.callTool({ name: MCP_TOOL.GET_FIX, arguments: { fixId: NEVER_ISSUED_FIX } }),
      );

      expect(SdkHttpError.isInstance(error)).toBe(true);
      expect((error as SdkHttpError).status).toBe(401);

      // OUR SENTENCE REACHES THE AGENT, VERBATIM. The 401 is produced before
      // the SDK is in the call stack, so on the legacy leg the client surfaces
      // our body rather than a summary of it — measured at `connect()`, and
      // this is the same pre-SDK path one verb later.
      expect(String((error as SdkHttpError).message)).toContain(UNAUTHENTICATED.message);

      // NO WEB-PROCESS RESTART, stated literally rather than implied.
      expect(process.pid).toBe(pidBefore);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E6 — should still serve a second live credential in the same process", async () => {
    // THE NON-VACUITY HALF. Without it, a surface that had simply stopped
    // answering everything would pass the row above perfectly.
    const wire = wireTo(serveMounted);
    const client = await openClient(wire, liveKey);

    try {
      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });

      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });
});
