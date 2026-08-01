# Decision 0005: The MCP server boundary, six gates in a fixed order

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `apps/web/lib/mcp/server.ts` when long-form rationale moved to docs.

**Decides:** how the read-only machine surface's transport boundary is composed, which
six gates it runs, in what order, and why that order is the security argument.
**Implemented by:** `apps/web/lib/mcp/server.ts`

---

## A plain function over `Request`, with both effects injected

The boundary is a plain function over `Request` with its two effects injected (the
credential source and the read port), so the whole surface is driven end to end through
its real entry point in tests, with fakes. This is the discipline
`worker/src/tasks/delivery-tick.ts` follows for the same reason.
`apps/web/app/api/mcp/route.ts` is the only queue of one line that knows about Next.js
and about which implementations are wired in.

## What this file decides, and what it does not

The boundary decides six things and then stops: who is asking, whether a browser is
asking, whether the body claims to be JSON, whether the verb is one this surface
answers, whether the body is small enough to read, and whether it is one message rather
than a batch of them. Everything past that (negotiation, the message envelope, framing,
error codes, the shape a result travels in) belongs to `apps/web/lib/mcp/wire.ts`, and
every decision a tool call makes belongs to `apps/web/lib/mcp/call-tool.ts`. Neither of
those is nameable from the boundary except by its one exported function, which is what
makes the seam a fact rather than a habit.

## The order of operations is part of the security argument

### 1. Authenticate first

Authentication runs before the body is read, before any header gate fires, before the
wire layer is constructed at all. An unauthenticated caller must not be able to learn
which tool names exist, which arguments are valid, whether a payload was well formed, or
even which media types this surface accepts. Every one of those is a probe, and the
answers differ. So there is exactly one thing an anonymous caller can find out: that it
is not authenticated.

This is why the 401 is pre-wire, and it is load-bearing. The refusal is produced before
the transport is anywhere in the call stack, so all six unauthenticated cases are
byte-identical by construction rather than by review, and the transport's own
content-negotiation refusal can never come back to a caller that presented no key.

The authentication helper fails closed on every path, including a credential store that
throws. A database outage becoming "not authenticated" rather than "service unavailable"
is deliberate: an authentication path that degrades open is not an authentication path,
and the difference is visible in the log where it belongs rather than on the wire where
it is an oracle.

### 2. The origin gate

A request carrying an `Origin` header at all is refused 403; a request carrying none
fails open and is served. That direction is the decision, not an oversight: an MCP
client is not a browser and sends no `Origin`, so failing closed on its absence would
refuse every real client and break `docker compose up` on every hostname, an exclusion
predicate firing on a superset of its real target. Failing open costs nothing here
because this surface carries no ambient credential: it is bearer-only and cookie-blind,
so a page cannot forge an authenticated call even when it reaches us. The 403 closes the
DNS-rebinding shape; it is not an authentication control.

Presence is the whole rule. No allow-list, no configuration, and no inspection of the
value.

### 3. The content-type gate

The gate fires on what a request declares. A body announced as anything other than JSON
is refused 415 with the sentence that says what to send. A request that declares nothing
is not refused here: a bodiless verb has no content type to be wrong about, and the
speculative `GET` a real client opens during its handshake is exactly that request. It
falls through to the verb gate below and is answered 405, which is what a correct
handshake expects.

The declaration is compared on its media type alone: `application/json` and
`application/json; charset=utf-8` are the same claim, and a gate that rejected the
second would refuse clients for punctuation.

### 4. The verb gate

`POST` and nothing else. Every other method is 405 with a sentence telling an agent what
to send instead, never a bodiless 405 from a framework, and never delegated to the
transport, which would answer without instructions. The catalogue is no longer a `GET`:
it moved onto the wire protocol as `tools/list`, so a `GET` has nothing left to answer
with.

### 5. The size gate

The gate operates on bytes and never on a header. The body is read here, once, through a
reader that stops at `MAX_BODY_BYTES` and cancels the rest, so an over-size body is
refused 413 having been bounded rather than buffered. `content-length` is not consulted:
it is absent on a chunked request and a caller writes it, which makes it a claim rather
than a measurement.

### 6. The batch gate

The gate looks at the first non-whitespace byte. A body that opens with `[` is a
JSON-RPC batch and is refused 400 with `MALFORMED_BODY`, whose first instruction is
already "send a single JSON-RPC message". The revision this surface negotiates removed
batching, no client it targets sends one, and `tools/list` and `tools/call` are single
messages, so the truthful answer is to refuse rather than to cap. Left open, one POST
bought 500 tool calls off one read-only credential. Measured: 500 reads and 500 frames
from one request, which against a real repository is 500 database round-trips.

This is a shape decision, not a parse. One byte is looked at, and no value is ever read
out of the body here; the "organization comes from the credential" claim below survives
this gate intact.

### 7. Hand off, once

`apps/web/lib/mcp/wire.ts` receives the request and an already-resolved credential. It
never authenticates, and it never sees a verb the boundary would have refused. The
request it receives is rebuilt from the bytes read above, because a body can only be
read once and the transport must read it too: same url, same method, same headers, the
same bytes.

## No `Accept` gate of our own

The transport already requires both media types on the leg a stock client negotiates and
refuses instructively when they are missing; a second, hand-rolled content-negotiation
classifier of ours would be the same shape declined for the protocol-version header.
What matters is that the transport's refusal sits behind the credential check, which the
gate ordering guarantees.

## The organization comes from the credential, and nothing reads a value out of a body

`McpCredential` is the only place an organization id exists in the boundary. The body is
read (the size and batch gates cannot be enforced without the bytes), but it is never
parsed: what those gates look at is a byte count and one non-whitespace character, and
there is no `JSON.parse` in the file and no line where a request value could be
substituted for the credential's organization. The read port travels through untouched
to `apps/web/lib/mcp/call-tool.ts`, which takes the credential as its own parameter for
the same structural reason.

## The zod position this file used to argue is retired, on a measurement

Two long comment blocks in the boundary used to argue that `apps/web` must never depend
on `zod`, because a second copy on disk would break `instanceof` against the schemas
`packages/shared` builds. The hazard requires two copies, and the tree was measured with
exactly one (`4.4.3`, hoisted) after the transport package was installed, and `zod` is
not resolvable from `apps/web` at all under bun's isolated linker, at runtime or under
typecheck. So the invariant is enforced by the installer rather than by an argument, and
the argument is withdrawn.

This matters downstream, which is why it is stated rather than deleted. The retired
position said "no schema object may cross into the wire layer". Taken as binding it
would break tool registration outright: registration requires a standard schema and
refuses a pre-rendered JSON Schema document. The shared Zod objects are handed across
verbatim, on purpose, so the object that validates a call is the object that renders
what a caller was shown. `apps/web/__tests__/mcp/no-direct-zod.test.ts` holds both
halves.

## The fault channels partition

The boundary's outer catch has a different job from `callTool`'s. That one owns a fault
inside a tool call (a read that broke, a spec that would not render, an output that
would not parse) and turns it into a refusal value without ever throwing. The boundary's
catch owns a fault in reading the body or in the wire layer itself, which is the only
way an exception can still arrive there. The third channel is the transport's own
`onerror` in `apps/web/lib/mcp/wire.ts`, which owns faults inside the SDK; those are
returned rather than thrown, so they are unreachable from the boundary's catch. No two
channels can fire for one event. `apps/web/__tests__/mcp/failure-isolation.test.ts`
requires exactly one log line for a broken read and
`apps/web/__tests__/mcp/wire-bounds.test.ts` names which one it must be. Do not add a
fourth catch around the tool core, and do not log a tool fault twice on its way out.
