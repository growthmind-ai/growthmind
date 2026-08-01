// The wire: The one file that knows this is MCP.
//
// The one import site
//
// This is the only source file in `apps/web/lib/**` and `apps/web/app/**` permitted to
// name `@modelcontextprotocol/server`, and a source scan asserts that the list of files
// naming it has exactly one entry. That confinement is what makes "we could swap the
// transport out" a fact rather than a hope: swapping it changes this file's imports and
// nothing else. No tool logic, no refusal sentence, no credential code, no schema.
//
// The v1 SDK package. The `/sdk` specifier under the same scope, seventeen runtime
// dependencies, no modern-era machinery. Is imported nowhere in this workspace, and a
// second scan asserts zero occurrences of its name anywhere. That scan is why its
// specifier is not spelled out even in this comment: a prose mention would be an
// occurrence, and the row would go red on a sentence that was only trying to be
// helpful. If you are here from v1 muscle memory, the transport lives on the package
// root export; there is no deep subpath.
//
// It renders, and it never decides
//
// Every decision this surface makes lives in `./call-tool.ts`, and every sentence it
// says lives in `./refusals.ts`. What happens below is framing and nothing else: build
// a server, hand it the three schemas somebody else declared, unwrap one JSON-RPC
// message, and turn the union `callTool` returned into the shape the protocol carries a
// result in. There is no branch here that reads a tool name, an organization, or a row.
//
// The handler is constructed per request, with `await handler.close` in a
//  `finally`. That keeps `getDb` per-request inside the composition root's
//  `resolveMcpDeps` — an invariant a module-scope memoised handler would
//  silently break. (`createMcpHandler` returns an object, not a callable:
//  serve with `handler.fetch(request)`.) Measured: the server factory runs
//  per exchange, close is clean, and closing twice is a no-op.
// `responseMode: "sse"` is written out as a property at the construction
//  site, never left to the sdk's `'auto'` default and never `"json"`. The
//  legacy leg — the one a stock client meets — has no framing option at all,
//  so `"json"` would not make the wire JSON; it would split the wire in two
//  and force every byte-identity row to be authored twice. One framing, one
//  set of rows. The literal must stay visible here rather than being hoisted
//  into a constant: a test asserts it is present at this construction site.
// `legacy: "stateless"` is passed explicitly. It is the verified default,
//  and it is load-bearing rather than decorative: the only alternative,
//  `"reject"`, makes a stock client fail its first POST with `-32022`.
// `maxSubscriptions: 0` refuses `subscriptions/listen` outright, and it is
//  an availability control rather than a preference. See the option's own
//  paragraph below `settled`.
// `onerror` is the transport's own fault channel, and it is the third of
//  three log sites rather than a duplicate of either. See its paragraph
//  below.
// Both protocol eras are served by this one handler, and nothing here is
//  era-specific. A stock client negotiates the legacy floor through
//  `initialize`; an opt-in client pinned to the modern era reaches the same
//  three tools through `server/discover`. There is no modern-off switch in
//  the transport's options, so this is not a preference — it is the only
//  implementable shape. We write no `initialize` handler, no session id, no
//  GET stream and no `_meta` of our own.
// The three tools are registered with the shared Zod schemas verbatim, and
//  then `tools/call` is overridden as one handler for the method, on the
//  inner `Server`, after the registration loop. Registration alone is not
//  enough — the facade resolves the tool name against its own registry first
//  and answers an unknown name with a protocol error carrying none of our
//  three tool names, which is precisely the refusal this surface exists to
//  give well.
// A refusal is rendered by calling `refusalToolResult` from `./refusals.ts`.
//  This file contains no refusal literal — one producer per wire form is what
//  makes two refusals built from one constant identical by construction, and
//  that identity is the cross-tenant proof.
// Every non-error result carries schema-valid `structuredContent`, built
//  from the same parsed output value, uniformly on every success. A client
//  that has listed the tools first compiles output validators from that
//  listing and rejects a result without it — measured, and invisible to any
//  server-side test.
//
// The errors this file does not produce
//
// Protocol-level errors, a body that is not JSON, a message with no `jsonrpc`, a method
// nobody implements, params that do not fit the envelope. Are the transport's, because
// they are framing. Nothing below emits a JSON-RPC error object, and `MALFORMED_BODY`
// in `./refusals.ts` is deliberately not reachable from here: the pre-protocol envelope
// reader that produced it is gone, and the transport's own parse error is the answer a
// caller now gets. Its one producer today is `./server.ts`'s batch gate, which refuses
// an array body before this file is reached at all. A shape decision made on the raw
// bytes, in front of the transport, never a second parser behind it.
//
// There is also no catch here. `callTool` does not throw. A fault inside a read, a
// renderer or an output schema is caught there, logged once, and comes back as a
// refusal value we render like any other. `./server.ts` keeps an outer catch for a
// fault in this file itself. Adding a third catch, or one that fires on faults those
// two already own, is how one incident becomes two log lines that disagree.
//
// The `onerror` below is not that third catch, and the distinction is the whole reason
// it exists. It is the transport's own fault channel, and it carries the faults neither
// of the other two can observe: the sdk's `reportError` is ` => { try { onerror?.
// } catch {} }`, and a fault inside the SDK is returned as `500 {"code":-32603}` rather
// than thrown, so `./server.ts`'s catch never sees it, and `callTool`'s catch is a
// layer further in. Left unwired, as it was until the post-sprint audit, a wire-layer
// failure answered a caller with a 500 and wrote zero log lines. That was a regression
// against the pre-transport behaviour, where the envelope reader was ours and its
// faults threw into `./server.ts`'s catch.
//
// So the three channels partition rather than overlap: `callTool` owns a fault inside a
// tool call, `./server.ts` owns a fault escaping this file, and this one owns a fault
// inside the SDK that neither can reach. The message below is distinct from both for
// exactly that reason. During an incident the sentence says which layer broke.
import { MCP_TOOLS } from "@growthmind/shared";
import {
  McpServer,
  createMcpHandler,
  type CallToolRequest,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

import { callTool, type McpToolOutcome } from "./call-tool";
import type { McpCredential } from "./credentials";
import type { McpReadPort } from "./read-port";
import { refusalToolResult } from "./refusals";

/**
 * How this server introduces itself.
 *
 * Nothing negotiates on either value. A client shows them in a server list, and the
 * modern era stamps them into a result's `_meta`. They are written here rather than
 * read from a manifest because a build that could not find its own `package.json` would
 * degrade a name into `undefined` on the wire rather than failing.
 */
const SERVER_NAME = "growthmind";
const SERVER_VERSION = "0.0.0";

/**
 * The method this file takes off the transport, so the one string it is spelled with is
 * written once. A typo here is a handler registered for a method nothing sends. A
 * silent no-op, which is the failure shape the whole vocabulary file exists to remove.
 */
const TOOLS_CALL = "tools/call";

/**
 * What the renderer cannot work out for itself: where the answers come from, and who is
 * asking.
 *
 * The credential arrives already resolved. Authentication happens in `./server.ts`, on
 * the raw request, before this file is reached at all, which is what keeps the 401 out
 * of the JSON-RPC envelope entirely and makes the largest refusal-identity set in the
 * sprint immune to anything the transport does.
 */
export interface McpWireDeps {
  readonly reads: McpReadPort;
  readonly credential: McpCredential;
}

/**
 * Serve one authenticated, gated request over the MCP wire.
 *
 * Called by `./server.ts` after it has authenticated the caller and cleared the Origin,
 * Content-Type, method, body-size and batch gates. Everything from here down is
 * framing: negotiation, the envelope, error codes for malformed input, and the shape a
 * result travels in are all the transport's, and none of them is a decision this
 * codebase makes.
 *
 * The `request` is rebuilt by `./server.ts` and that is invisible here. A body can only
 * be read once and the two gates above had to read it, so what arrives is a fresh
 * `Request` over the same url, method, headers and bytes. Nothing below can tell, and
 * nothing below should have to.
 */
export async function renderMcpWire(request: Request, deps: McpWireDeps): Promise<Response> {
  const handler = createMcpHandler(() => buildServer(deps), {
    responseMode: "sse",
    legacy: "stateless",
    maxSubscriptions: 0,
    onerror: reportTransportFault,
  });

  try {
    return await settled(await handler.fetch(request));
  } finally {
    // Per request, torn down per request. The legacy leg holds nothing between
    // exchanges by construction, and the modern leg's per-request instance is released
    // here rather than at whatever moment a garbage collector chose.
    await handler.close();
  }
}

/**
 * The answer, finished, before the handler that produced it is torn down.
 *
 * ⚠️ this is not an optimisation and it is not decoration, without it the modern leg
 * hangs. `close` aborts every modern exchange still in flight, and on that leg
 * `fetch` resolves with a response whose body is still being written: the frame is
 * streamed after the headers are handed back. Tearing the handler down at that moment
 * cuts the stream before the message reaches the client, which a real client
 * experiences as a request that never answers. Measured: `connect` succeeds and
 * `listTools` times out.
 *
 * So the stream is drained here, while the handler is still alive, and the finished
 * bytes are handed on. The legacy leg (the one a stock client meets) behaves
 * identically either way, and this surface streams nothing worth preserving: it emits
 * no notifications, no progress and no logging, so a response is one frame and draining
 * it costs a copy of a few hundred bytes.
 *
 * ⚠️ "a response is one frame" was TRUE of every answer this file produces and FALSE of
 * one the SDK produces behind it, and that gap was a hang. The modern leg carries
 * `subscriptions/listen`, answered by the sdk's own listen router with an SSE stream
 * that ends only on client disconnect or `handler.close`. The drain above then waited
 * for a stream only the teardown could end, and the teardown in `renderMcpWire`'s
 * `finally` waited for the drain: a deadlock, one per request, each pinning a server
 * instance and a 15-second keep-alive timer. Measured, before the fix: one such request
 * unanswered at 45 seconds, and 50 concurrent ones with none answered.
 *
 * The fix is `maxSubscriptions: 0` at the construction site above, and it is truthful
 * rather than a workaround. This surface declares no subscription capability and emits
 * no notifications, so there is nothing a subscriber could ever be sent; the sdk's
 * limit guard is nullish-coalesced, so `0` is honoured rather than treated
 * as absent, and the same request now answers in about a millisecond with `200
 * {"error":{"code":-32603,"message": "Subscription limit reached"}}` and no stream at
 * all. If this surface ever grows a notification worth sending, raising that number is
 * the moment to re-read this paragraph. The drain above is what makes a streaming
 * answer impossible, not an accident that could be left in place beside one.
 *
 * Nothing about the answer moves. The status, the status text and every header are the
 * transport's, carried across unchanged; the body is the same bytes. A response with no
 * body at all. The `202` a notification is answered with, which carries no
 * `content-type` and must not grow one. Is returned exactly as it arrived, never
 * rebuilt.
 */
async function settled(response: Response): Promise<Response> {
  if (response.body === null) {
    return response;
  }

  const body = await response.text();

  return new Response(body.length === 0 ? null : body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * The transport's own fault channel, and the third of exactly three log sites.
 *
 * One line, and a sentence neither of the other two writes. `callTool` logs "a tool
 * call could not be completed"; `./server.ts` logs "the wire could not answer a
 * request"; this logs that the fault was inside the SDK, where neither of them can see
 * it. Three partitioned channels, never three claims on one event. The file header
 * argues the partition, and `__tests__/mcp/failure-isolation.test.ts` still requires
 * exactly one line for a broken read, which never reaches this channel because
 * `callTool` does not throw.
 *
 * The error object goes to the log and nowhere else. The sdk's contract for this
 * callback is reporting-only (it never alters the response) so the caller still gets
 * the transport's own detail-free frame, exactly as before. That asymmetry is the
 * point: the detail is ours, the sentence is theirs.
 *
 * What actually arrives here, measured. On the legacy leg the SDK constructs its
 * transport without wiring this callback into it, so the legacy content negotiation
 * , media type and parse refusals are silent here and every
 * existing contract row's log count is untouched. What does arrive: a factory or
 * serving failure on either leg, a rejected inbound request the entry classified, a
 * modern-leg protocol rejection, and the `subscriptions/listen` refusal
 * `maxSubscriptions: 0` produces.
 *
 * The message rather than the error object, and that is deliberate here where it would
 * be wrong in the other two. Those two catch faults raised by our code, where a stack
 * is the point. What the SDK hands this callback is overwhelmingly a rejected request
 * (its own documented wording) whose every frame is inside the package and names none
 * of our files, so the object buys a screenful of node_modules for a sentence that
 * already said everything. One fault, one line, readable during an incident.
 */
function reportTransportFault(error: Error): void {
  console.error("mcp: the transport reported a fault", error.message);
}

/**
 * One server instance, for one exchange.
 *
 * The order of the two halves is the whole design (measured). The registration loop is
 * what produces the advertised `inputSchema` and `outputSchema` documents a client
 * parses out of `tools/list`, so it cannot be skipped in favour of hand-built catalogue
 * documents, which would be a second producer of the contract and free to drift from
 * the first. But registration alone resolves `params.name` against the facade's own
 * registry before any code of ours runs, and answers an unknown name with a protocol
 * error carrying none of our three tool names. So: register, then override the method.
 * On the inner `Server`, after the loop. Registered before the loop, the loop's own
 * wiring re-claims the method and the override never runs.
 */
function buildServer(deps: McpWireDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // Verbatim, and that is the point: the object that validates a call is the
        // object that renders what a caller was shown, so the advertised schema and the
        // validator cannot drift.
        inputSchema: asStandardSchema(tool.inputSchema),
        outputSchema: asStandardSchema(tool.outputSchema),
        // The flat hint, mapped onto the wire's nested one. A descriptor carries
        // `readOnlyHint` beside its name; a client reads `annotations.readOnlyHint`.
        // Nobody else performs this mapping, so a read-only promise that stopped being
        // made here would simply stop reaching the client, with nothing to notice.
        annotations: { readOnlyHint: tool.readOnlyHint },
      },
      // Unreachable once the override below is in place, and kept trivial for exactly
      // that reason: two live paths to one effect is a dual producer waiting to happen.
      // Registration here is declarative. It exists to advertise, never to answer.
      unreachableToolCallback,
    );
  }

  server.server.setRequestHandler(TOOLS_CALL, async (request: CallToolRequest) => {
    // `arguments` absent is not `arguments: {}` on the wire, and a client with nothing
    // to send omits the key. Unwrapping the absence into an empty object is the
    // envelope's own semantics. Every default a tool's schema declares is then applied
    // by that schema, here as everywhere else.
    const outcome = await callTool(
      request.params.name,
      request.params.arguments ?? {},
      deps.reads,
      deps.credential,
    );
    return renderOutcome(outcome);
  });

  return server;
}

/**
 * One decided tool call, as the protocol carries it.
 *
 * Both arms travel on HTTP 200. A refusal is a tool execution error, `isError: true`
 * with the sentence in a text block, never a JSON-RPC error object, which a client may
 * render as a transport failure and put our sentence somewhere the model never reads
 * it.
 */
function renderOutcome(outcome: McpToolOutcome): CallToolResult {
  if (!outcome.ok) {
    // The one producer of this wire form. No refusal literal exists in this file, which
    // is what makes two refusals built from one constant identical byte for byte rather
    // than identical by review.
    //
    // Spread rather than returned directly, and it costs nothing: the transport's
    // result type carries an open index signature, which a declared interface is not
    // assignable to. The keys, their order and their values are still the producer's.
    // This widens the type without authoring the shape, which is the line that must not
    // be crossed here.
    return { ...refusalToolResult(outcome.refusal) };
  }

  // And it applies to every tool rather than to the one that has a non-error answer
  // today. A tool that advertises an `outputSchema` and answers without schema-valid
  // `structuredContent` is rejected client-side once the client has listed the tools.
  // It compiles an output validator from the advertised document, and the server never
  // complains. `get_fix` and `get_finding` only escape it today because they answer
  // NOT_FOUND as execution errors, and execution errors are exempt; the moment they
  // return a real record they inherit this line unchanged.
  //
  // The text block beside it is the same value serialised, for a client that reads
  // `content` and nothing else.
  return {
    content: [{ type: "text", text: JSON.stringify(outcome.result) }],
    structuredContent: asStructuredContent(outcome.result),
  };
}

/**
 * The callback registration requires and the override makes unreachable.
 *
 * It answers nothing rather than answering badly: if the override below it is ever
 * removed or mis-registered, an empty result is a visible, immediate failure in every
 * tool row, where a plausible-looking second implementation would be a silent second
 * producer of the contract.
 */
function unreachableToolCallback(): CallToolResult {
  return { content: [] };
}

/**
 * A shared schema, as the transport's registration types name it.
 *
 * Measured, not assumed. `registerTool` requires a Standard Schema carrying both
 * `~standard.validate` (to check an incoming call's arguments) and
 * `~standard.jsonSchema` (to advertise the shape). It refuses a plain JSON Schema
 * document outright. Zod v4 implements both at runtime, and Wave 0 registered all six
 * shared schemas with nothing thrown; what it does not do is declare `jsonSchema` on
 * `ZodType`'s public `~standard` type, so the two interfaces agree in behaviour and not
 * in signature. The assertion is confined to this one function, and
 * `__tests__/mcp/no-direct-zod.test.ts` holds the runtime half. Both halves of
 * `~standard` are asserted present on every tool.
 */
function asStandardSchema(schema: unknown): StandardSchemaWithJSON {
  return schema as StandardSchemaWithJSON;
}

/**
 * A parsed tool output, as `structuredContent`.
 *
 * `callTool` returns `unknown` on purpose. The shape differs per tool and has already
 * been parsed by the schema that owns it, so typing it as a union of three would be a
 * second copy of the contract. What is asserted here is only that the parsed value is
 * an object, which every one of the three output schemas guarantees: all three render a
 * `"type": "object"` root, measured, so the transport's non-object wrap path is never
 * reached and the value the client validates is the value the schema produced.
 */
function asStructuredContent(result: unknown): Record<string, unknown> {
  return result as Record<string, unknown>;
}
