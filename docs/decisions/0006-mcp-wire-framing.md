# Decision 0006: The MCP wire, one file that knows the transport

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `apps/web/lib/mcp/wire.ts` when long-form rationale moved to docs.

**Decides:** how the MCP transport package is confined to one import site, how the SDK
handler is constructed and framed, and how transport faults are logged without
overlapping the other two fault channels.
**Implemented by:** `apps/web/lib/mcp/wire.ts`

---

## The one import site

`apps/web/lib/mcp/wire.ts` is the only source file in `apps/web/lib/**` and
`apps/web/app/**` permitted to name the MCP transport package, and a source scan asserts
that the list of files naming it has exactly one entry. That confinement is what makes
"we could swap the transport out" a fact rather than a hope: swapping it changes this
file's imports and nothing else. No tool logic, no refusal sentence, no credential code,
no schema.

The v1 SDK package (the `/sdk` specifier under the same scope, seventeen runtime
dependencies, no modern-era machinery) is imported nowhere in this workspace, and a
second scan asserts zero occurrences of its name anywhere under `apps/web` and
`packages`. That scan is why its specifier is not spelled out even in the source's
comments: a prose mention would be an occurrence, and the row would go red on a sentence
that was only trying to be helpful. For anyone arriving with v1 muscle memory: the
transport lives on the package root export; there is no deep subpath.

## It renders, and it never decides

Every decision this surface makes lives in `apps/web/lib/mcp/call-tool.ts`, and every
sentence it says lives in `apps/web/lib/mcp/refusals.ts`. What the wire file does is
framing and nothing else: build a server, hand it the three schemas somebody else
declared, unwrap one JSON-RPC message, and turn the union `callTool` returned into the
shape the protocol carries a result in. There is no branch that reads a tool name, an
organization, or a row.

## The construction site, option by option

- The handler is constructed per request, with `await handler.close` in a `finally`.
  That keeps `getDb` per-request inside the composition root's `resolveMcpDeps`, an
  invariant a module-scope memoised handler would silently break. (`createMcpHandler`
  returns an object, not a callable: serve with `handler.fetch(request)`.) Measured: the
  server factory runs per exchange, close is clean, and closing twice is a no-op.
- `responseMode: "sse"` is written out as a property at the construction site, never
  left to the sdk's `'auto'` default and never `"json"`. The legacy leg, the one a stock
  client meets, has no framing option at all, so `"json"` would not make the wire JSON;
  it would split the wire in two and force every byte-identity row to be authored twice.
  One framing, one set of rows. The literal must stay visible at the construction site
  rather than being hoisted into a constant: a test asserts it is present there.
- `legacy: "stateless"` is passed explicitly. It is the verified default, and it is
  load-bearing rather than decorative: the only alternative, `"reject"`, makes a stock
  client fail its first POST with `-32022`.
- `maxSubscriptions: 0` refuses `subscriptions/listen` outright, and it is an
  availability control rather than a preference: without it, a `subscriptions/listen`
  request opens a stream only teardown can end, and the drain in `settled` deadlocks
  against the `finally` that closes the handler (the full account is in `settled`'s own
  doc comment in the source).
- `onerror` is the transport's own fault channel, and it is the third of three log sites
  rather than a duplicate of either. See "the three fault channels" below.

## Both protocol eras, one handler

Both protocol eras are served by this one handler, and nothing in the file is
era-specific. A stock client negotiates the legacy floor through `initialize`; an opt-in
client pinned to the modern era reaches the same three tools through `server/discover`.
There is no modern-off switch in the transport's options, so this is not a preference;
it is the only implementable shape. We write no `initialize` handler, no session id, no
GET stream and no `_meta` of our own.

## Register, then override

The three tools are registered with the shared Zod schemas verbatim, and then
`tools/call` is overridden as one handler for the method, on the inner `Server`, after
the registration loop. The order of the two halves is the whole design (measured). The
registration loop is what produces the advertised `inputSchema` and `outputSchema`
documents a client parses out of `tools/list`, so it cannot be skipped in favour of
hand-built catalogue documents, which would be a second producer of the contract and
free to drift from the first. But registration alone resolves `params.name` against the
facade's own registry before any code of ours runs, and answers an unknown name with a
protocol error carrying none of our three tool names, which is precisely the refusal
this surface exists to give well. So: register, then override the method. Registered
before the loop, the loop's own wiring re-claims the method and the override never runs.

Handing the schemas across verbatim is the point: the object that validates a call is
the object that renders what a caller was shown, so the advertised schema and the
validator cannot drift.

## One producer per wire form

A refusal is rendered by calling `refusalToolResult` from
`apps/web/lib/mcp/refusals.ts`. The wire file contains no refusal literal. One producer
per wire form is what makes two refusals built from one constant identical byte for
byte, and that identity is the cross-tenant proof.

Every non-error result carries schema-valid `structuredContent`, built from the same
parsed output value, uniformly on every success. A client that has listed the tools
first compiles output validators from that listing and rejects a result without it:
measured, and invisible to any server-side test.

## The errors this file does not produce

Protocol-level errors (a body that is not JSON, a message with no `jsonrpc`, a method
nobody implements, params that do not fit the envelope) are the transport's, because
they are framing. Nothing in the wire file emits a JSON-RPC error object, and
`MALFORMED_BODY` in `apps/web/lib/mcp/refusals.ts` is deliberately not reachable from
it: the pre-protocol envelope reader that produced it is gone, and the transport's own
parse error is the answer a caller now gets. Its one producer today is the batch gate in
`apps/web/lib/mcp/server.ts`, which refuses an array body before the wire file is
reached at all: a shape decision made on the raw bytes, in front of the transport, never
a second parser behind it.

There is also no catch in the wire file. `callTool` does not throw: a fault inside a
read, a renderer or an output schema is caught there, logged once, and comes back as a
refusal value rendered like any other. `apps/web/lib/mcp/server.ts` keeps an outer catch
for a fault in the wire file itself. Adding a third catch, or one that fires on faults
those two already own, is how one incident becomes two log lines that disagree.

## The three fault channels

The `onerror` callback is not that third catch, and the distinction is the whole reason
it exists. It is the transport's own fault channel, and it carries the faults neither of
the other two can observe: the sdk's `reportError` is
`(error) => { try { onerror?.(error) } catch {} }`, and a fault inside the SDK is
returned as `500 {"code":-32603}` rather than thrown, so the outer catch in
`apps/web/lib/mcp/server.ts` never sees it, and `callTool`'s catch is a layer further
in. Left unwired, as it was until a later audit, a wire-layer failure answered a caller
with a 500 and wrote zero log lines. That was a regression against the pre-transport
behaviour, where the envelope reader was ours and its faults threw into the outer catch.

So the three channels partition rather than overlap: `callTool` owns a fault inside a
tool call, `apps/web/lib/mcp/server.ts` owns a fault escaping the wire file, and
`onerror` owns a fault inside the SDK that neither can reach. The three log messages are
distinct for exactly that reason: during an incident the sentence says which layer
broke.
