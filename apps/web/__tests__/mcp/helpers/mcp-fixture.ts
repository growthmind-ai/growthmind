// The fixture the MCP suites drive the real entry point with.
//
// What this file is and is not. It is a two-organization store behind the real
// `McpReadPort` interface, and a credential source behind the real
// `McpCredentialSource` interface. It is not a re-implementation of the route: every
// test calls `handleMcpRequest` with a real `Request` and asserts on a real `Response`,
// so what is proven is the handler's behaviour and not a replica's.
//
// The fake read port enforces the port's own contract, deliberately. Its header
// requires that an implementation filter by organization in the same predicate as the
// id, so the fake does exactly that, one `find` over one condition, with no "look it up
// then check who owns it" step anywhere. A fake that checked ownership separately would
// be modelling the bug the contract forbids, and the cross-tenant suite would then be
// proving the fake rather than the route.
//
// Fixture time is a constant. Nothing here reads a clock, so a rendered spec is the
// same string on every run and in every timezone.
//
// Every request minted here is a legacy-leg request
//
// The transport serves two protocol eras from one handler, and which era a request
// lands on is decided by the request itself, not by a server option. A request is
// modern if and only if it carries the `_meta` claim keys
// (`io.modelcontextprotocol/protocolVersion`, `…/clientInfo`, `…/clientCapabilities`)
// together with matching `Mcp-Method` and (for a tool call) `Mcp-Name` headers. Nothing
// in this file mints any of that, so everything it produces classifies legacy.
//
// That is deliberate and it is load-bearing, not an accident of convenience:
//
// Legacy is the leg a stock client meets. `new Client({name, version})`
//  with no options negotiates `2025-11-25` and connects — measured. The
//  north star is about that client, so the fixture-driven suite asserts
//  against the leg that client actually reaches.
// The two legs answer with different bytes. A modern result carries
//  `resultType:"complete"` and `_meta.serverInfo` that the legacy frame does
//  not. Roughly forty rows across four other test files fingerprint the
//  whole body, so a helper that quietly grew a modern envelope would move
//  every one of them onto a different string while they kept passing.
// `WIRE-G6` asserts the `Accept` 406, which fires on the legacy leg only —
//  the modern leg answers 200 to `application/json` alone. Minted modern,
//  that row would pass for the wrong reason.
//
// SO: Do not add a modern-envelope variant to this file without a decision. The modern
// leg is exercised where it belongs. Through a real `Client` in
// `../real-client.test.ts`, and nowhere else.
//
// Lane prefix `mcp`, shared with no other suite.
import type { CandidateFinding, DetectorCoverage, MeasuredCount } from "@growthmind/core";
import { candidateFindingSchema, measuredCount, traceEntry } from "@growthmind/core";
import { createApiKeysRepo, type ScopedDb } from "@growthmind/db";
import type { McpMeasuredCount, TenantContext } from "@growthmind/shared";
import { mcpMeasuredCountSchema } from "@growthmind/shared";

import type { McpCredential, McpCredentialSource } from "../../../lib/mcp/credentials";
import type {
  FindingRecord,
  FixRecord,
  GetFindingQuery,
  GetFixQuery,
  ListOpenFixesQuery,
  McpReadPort,
  OpenFixPage,
  OpenFixRow,
} from "../../../lib/mcp/read-port";

// Frozen fixture time and identities

export const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
export const WINDOW_END = new Date("2026-06-08T00:00:00.000Z");

export const ORG_A = "org-mcp-a";
export const ORG_B = "org-mcp-b";

/** Presented credential material. Opaque strings: the fake credential source matches
 * them exactly, the way a real one matches a stored hash. */
export const KEY_A = "mcp-fixture-key-org-a";
export const KEY_B = "mcp-fixture-key-org-b";

const KEPT = 25;
const REACHED = 25;
const LEFT = 12;

const CLEAN_COVERAGE: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

// Counts

function coreCount(numerator: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: KEPT,
    unit: "sessions",
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: KEPT, kept: KEPT, setAside: [] },
  });
}

/**
 * The wire mirror of a count. Parsed through `mcpMeasuredCountSchema`, so a fixture
 * cannot carry a count the contract would refuse and quietly make a test pass on a
 * shape production could never produce.
 */
export function wireCount(numerator: number): McpMeasuredCount {
  return mcpMeasuredCountSchema.parse({
    numerator,
    denominator: KEPT,
    unit: "sessions",
    timeframe: { start: WINDOW_START.toISOString(), end: WINDOW_END.toISOString() },
    basis: { totalInWindow: KEPT, kept: KEPT, setAside: [] },
  });
}

// Records

/**
 * A `CandidateFinding` parsed through its own schema, so no fixture here can drift from
 * the contract `renderFixSpec` is typed against. Shaped after the funnel fixture in
 * `packages/core/__tests__/fixes/fix-spec.test.ts`: two counts in declared role order
 * with different numerators.
 */
export function candidateFor(surface: string): CandidateFinding {
  const counts = [coreCount(REACHED), coreCount(LEFT)];
  return candidateFindingSchema.parse({
    detector: "funnel_dropoff",
    claimedClass: "confusing",
    finalClass: "confusing",
    trace: [
      traceEntry({
        class: "confusing",
        predicate: "confusing_mcp",
        predicateVersion: 1,
        satisfied: true,
      }),
    ],
    counts,
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    claimSubject: "surface",
    surface,
    surfaceNormalisationVersion: 1,
    evidenceShape: "mcp-evidence-shape",
    evidenceShapeVersion: 1,
    thresholdRuleSetVersion: 1,
    ranking: { sampleSize: counts[0], confidenceBasis: "threshold_met" },
    coverage: CLEAN_COVERAGE,
  });
}

export function fixRecordFor(input: {
  fixId: string;
  findingId: string;
  resultsBy: string;
  surface?: string;
}): FixRecord {
  return {
    fixId: input.fixId,
    findingId: input.findingId,
    status: "open",
    spec: { candidate: candidateFor(input.surface ?? "/mcp/pricing"), signals: [] },
    attempt: 1,
    alreadyLanded: [],
    impact: wireCount(LEFT),
    resultsBy: input.resultsBy,
  };
}

export function openFixRowFor(input: {
  fixId: string;
  findingId: string;
  resultsBy: string;
}): OpenFixRow {
  return {
    fixId: input.fixId,
    findingId: input.findingId,
    summary: "People are leaving the pricing page without going any further.",
    impact: wireCount(LEFT),
    openedAt: WINDOW_START.toISOString(),
    resultsBy: input.resultsBy,
  };
}

export function findingRecordFor(input: {
  findingId: string;
  fixId: string | null;
}): FindingRecord {
  return {
    findingId: input.findingId,
    fixId: input.fixId,
    headline: "People are leaving the pricing page without going any further.",
    detail:
      "We saw sessions reach the pricing page and stop there. We are not saying why they stopped.",
    surface: { name: "the pricing page", path: "/mcp/pricing" },
    affected: wireCount(LEFT),
    firstSeenAt: WINDOW_START.toISOString(),
    lastSeenAt: WINDOW_END.toISOString(),
    evidence: [
      { kind: "session_replay", label: "A recording of one visit that stopped here.", url: null },
    ],
  };
}

// The fake credential source

/**
 * Presented material to organization, by exact match. The fake mirror of a hash lookup.
 * Anything not in the map resolves to `null`, which is the fail-closed direction the
 * port's contract requires.
 */
export function fakeCredentials(byMaterial: Readonly<Record<string, string>>): McpCredentialSource {
  return {
    resolve(presented: string): Promise<McpCredential | null> {
      const organizationId = byMaterial[presented];
      return Promise.resolve(organizationId === undefined ? null : { organizationId });
    },
  };
}

// A real credential, minted the way a person mints one

/** What a minted read credential gives a test: the material to present, and the id to
 * revoke it by. Never the hash, `MintedApiKey.key` carries no secret, and neither does
 * this. */
export interface MintedTestApiKey {
  readonly raw: string;
  readonly id: string;
}

/**
 * Mints a real `api_keys` row through the production repository, the same call
 * `scripts/mint-api-key.ts` makes, against a real database with real migrations. This
 * is deliberately not a fake: the suites that use it are proving the production
 * resolution path (`isApiKeyFormat`, the hash lookup, the revocation predicate), which
 * a hand-built row could not exercise.
 *
 * `apps/web` has no `drizzle-orm` and no `zod` dependency and must not gain one, so
 * every seeded credential in this lane goes through `@growthmind/db`'s factories rather
 * than through a query written here.
 */
export async function mintRealApiKey(
  db: ScopedDb,
  ctx: TenantContext,
  name: string,
): Promise<MintedTestApiKey> {
  const minted = await createApiKeysRepo(db, ctx).mint({ name });
  return { raw: minted.raw, id: minted.key.id };
}

/** A credential source that throws. The "credential store unreachable" path, which must
 * fail closed rather than open. */
export function throwingCredentials(): McpCredentialSource {
  return {
    resolve(): Promise<McpCredential | null> {
      return Promise.reject(new Error("mcp fixture: the credential store is unreachable"));
    },
  };
}

// The fake read port

/** One stored open fix, with the organization and project it belongs to. */
export interface StoredOpenFix {
  readonly organizationId: string;
  readonly projectId: string;
  readonly row: OpenFixRow;
}

export interface StoredFix {
  readonly organizationId: string;
  readonly record: FixRecord;
}

export interface StoredFinding {
  readonly organizationId: string;
  readonly record: FindingRecord;
}

export interface FakeReadStore {
  readonly openFixes?: readonly StoredOpenFix[];
  readonly fixes?: readonly StoredFix[];
  readonly findings?: readonly StoredFinding[];
}

/** Every organization id the handler asked this port about, in order. The cross-tenant
 * suite asserts this never contains an organization other than the credential's. */
export interface RecordingReadPort {
  readonly port: McpReadPort;
  readonly organizationsAsked: readonly string[];
}

export function fakeReadPort(store: FakeReadStore = {}): RecordingReadPort {
  const openFixes = store.openFixes ?? [];
  const fixes = store.fixes ?? [];
  const findings = store.findings ?? [];
  const organizationsAsked: string[] = [];

  const port: McpReadPort = {
    listOpenFixes(query: ListOpenFixesQuery): Promise<OpenFixPage> {
      organizationsAsked.push(query.organizationId);

      // One predicate, both conditions. The port contract's rule 1 and 3. A project id
      // belonging to another organization matches nothing here because the organization
      // condition is in the same test.
      const matching = openFixes.filter(
        (stored) =>
          stored.organizationId === query.organizationId &&
          (query.projectId === null || stored.projectId === query.projectId),
      );

      const ordered = matching
        .map((stored) => stored.row)
        .toSorted((left, right) => Date.parse(left.resultsBy) - Date.parse(right.resultsBy));

      return Promise.resolve({
        fixes: ordered.slice(0, query.limit),
        totalOpen: matching.length,
      });
    },

    getFix(query: GetFixQuery): Promise<FixRecord | null> {
      organizationsAsked.push(query.organizationId);
      const found = fixes.find(
        (stored) =>
          stored.organizationId === query.organizationId && stored.record.fixId === query.fixId,
      );
      return Promise.resolve(found?.record ?? null);
    },

    getFinding(query: GetFindingQuery): Promise<FindingRecord | null> {
      organizationsAsked.push(query.organizationId);
      const found = findings.find(
        (stored) =>
          stored.organizationId === query.organizationId &&
          stored.record.findingId === query.findingId,
      );
      return Promise.resolve(found?.record ?? null);
    },
  };

  return { port, organizationsAsked };
}

/**
 * A read port whose every method rejects. The "the database is not answering" path.
 *
 * Lives here rather than in one test file because three separate rows need the same
 * fake: `WIRE-S5` (a read that throws still comes back as a refusal value, never an
 * exception and never a `Response`), `WIRE-B1` (the fault is logged and the caller gets
 * a detail-free answer) and `WIRE-B2` (nothing escapes the mounted handler as an
 * unhandled rejection). Three hand-rolled copies would be three chances to throw a
 * subtly different thing and prove three different properties.
 *
 * The message names the fixture so a leaked stack frame is obvious in the row that
 * scans a response for one.
 */
function unreachableRead(): Promise<never> {
  return Promise.reject(new Error("mcp fixture: the read port is unreachable"));
}

export function throwingReadPort(): McpReadPort {
  return {
    listOpenFixes: unreachableRead,
    getFix: unreachableRead,
    getFinding: unreachableRead,
  };
}

// Driving the real entry point

export const MCP_URL = "http://localhost:3000/api/mcp";

/**
 * The headers every minted request carries, in one constant applied by all three
 * constructors so that no test can forget one.
 *
 * Both `accept` values are required by the transport on the legacy leg. Sending
 * `application/json` alone is answered HTTP 406 there,
 * `{"error":{"code":-32000,"message":"Not Acceptable: Client must accept both
 * application/json and text/event-stream"}}`. Before the body is parsed and before any
 * tool is resolved. Measured, twice: it is a legacy-leg behaviour (the modern leg
 * answers 200 to `application/json` alone), and the pinned `responseMode` does not
 * relax it.
 *
 * This is the truthful default rather than a workaround: a real MCP client sends both
 * values too. Around forty rows across four other files assert against what these
 * constructors mint, and without this header every one of them would be asserting
 * against the transport's 406 instead of the refusal, result or error frame it names.
 * If you are here to "simplify" the second media type away, that is the thing you would
 * be breaking.
 */
export const WIRE_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
} as const;

/**
 * A deliberate, per-row deviation from `WIRE_HEADERS`, never a default.
 *
 * Three rows exist precisely to prove a header gate: `WIRE-G1` sends an `Origin`,
 * `WIRE-G3` sends the wrong `content-type`, and `WIRE-G6` sends a narrowed `accept`.
 * They start from `WIRE_HEADERS` and override one entry, so the deviation is visible at
 * the call site and everything else stays truthful.
 *
 * Not a door to the modern leg. `Mcp-Method` / `Mcp-Name` are half of the modern
 * classification and the `_meta` claim keys (the other half) are not reachable through
 * this at all, because the body is built below. See the file header.
 */
export type WireHeaderOverrides = Readonly<Record<string, string>>;

function wireHeaders(key: string | null | undefined, overrides?: WireHeaderOverrides): Headers {
  const headers = new Headers(WIRE_HEADERS);
  if (typeof key === "string") {
    headers.set("authorization", `Bearer ${key}`);
  }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    headers.set(name, value);
  }
  return headers;
}

/**
 * A `tools/call` as a real `Request`. `key` omitted means no credential at all.
 *
 * `id` defaults to 1, and that default is why the exclusion list is empty (rule 4).
 * The identity rows compare two responses byte for byte over `await response.text`;
 * the JSON-RPC id is echoed into every answer, so two requests can only be
 * byte-identical if they shared an id. Defaulting it here means a test has to go out of
 * its way to vary it, and no row has to remember to pin it. Measured: nothing else in a
 * response varies between two identical requests. No SSE `id:` line is emitted on
 * either leg under any `responseMode`, so with the id held constant there is nothing to
 * exclude.
 */
export function toolCallRequest(input: {
  tool: string;
  input?: unknown;
  key?: string | null;
  id?: number | string;
  headers?: WireHeaderOverrides;
}): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers: wireHeaders(input.key, input.headers),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: input.id ?? 1,
      method: "tools/call",
      params: { name: input.tool, arguments: input.input ?? {} },
    }),
  });
}

/**
 * Any JSON-RPC message, for the envelope suite.
 *
 * `params` is omitted from the body when it is not given, rather than sent as `null` or
 * `{}`, `WIRE-W6` asserts that a request with no params at all is answered rather than
 * thrown on, and a helper that always sent a params key would make that row untestable
 * through the fixture.
 *
 * `id` follows `toolCallRequest`'s rule and defaults to 1. Pass `null` explicitly for
 * `WIRE-W2` (a null id is answered rather than dropped); use `notificationRequest` for
 * a message carrying no id key at all.
 */
export function rpcRequest(input: {
  method: string;
  params?: unknown;
  id?: number | string | null;
  key?: string | null;
  headers?: WireHeaderOverrides;
}): Request {
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: input.id === undefined ? 1 : input.id,
    method: input.method,
  };
  if (input.params !== undefined) {
    body.params = input.params;
  }

  return new Request(MCP_URL, {
    method: "POST",
    headers: wireHeaders(input.key, input.headers),
    body: JSON.stringify(body),
  });
}

/**
 * A JSON-RPC notification, a message with no `id` key at all, which the protocol
 * answers with no message in the body.
 *
 * Separate from `rpcRequest` rather than a fourth state of its `id` parameter, because
 * "no id" and "id: null" are different messages on the wire and `WIRE-W2` and `WIRE-W4`
 * assert different things about them. One name each is cheaper than one parameter that
 * means three things.
 */
export function notificationRequest(input: {
  method: string;
  params?: unknown;
  key?: string | null;
  headers?: WireHeaderOverrides;
}): Request {
  const body: Record<string, unknown> = { jsonrpc: "2.0", method: input.method };
  if (input.params !== undefined) {
    body.params = input.params;
  }

  return new Request(MCP_URL, {
    method: "POST",
    headers: wireHeaders(input.key, input.headers),
    body: JSON.stringify(body),
  });
}

/**
 * A request on a verb other than POST. For the rows that prove nothing else is mounted
 * (`WIRE-R7`, `WIRE-M2`) and the ones that sweep every answer for a header (`WIRE-G5`).
 *
 * No body, and the same headers as everything else: a verb row must fail on the verb,
 * never on a header the helper forgot.
 */
export function verbRequest(input: {
  method: string;
  key?: string | null;
  headers?: WireHeaderOverrides;
}): Request {
  return new Request(MCP_URL, {
    method: input.method,
    headers: wireHeaders(input.key, input.headers),
  });
}

/**
 * A request whose body is whatever string you hand it, not JSON at all, a JSON-RPC
 * message missing a required field, or a batch array.
 *
 * This carries `accept` too, and that was a correction. The first draft marked this
 * constructor unchanged; without both media types the transport answers 406 before the
 * parser is reached, and `WIRE-R2` / `WIRE-W7` (which exist to prove a parse error)
 * would assert against a content-negotiation refusal instead.
 *
 * `key` accepts `null` so the anonymous-caller rows (`WIRE-O1`, `WIRE-R22`) can mint
 * through the same place as everything else rather than hand-rolling a `Request` that
 * would forget the header this constructor exists to remember.
 */
export function rawBodyRequest(
  body: string,
  key: string | null,
  headers?: WireHeaderOverrides,
): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers: wireHeaders(key, headers),
    body,
  });
}

/**
 * Everything about a response that a caller could tell two answers apart by.
 *
 * The identity assertions compare this, not a parsed body: two responses that differ in
 * status, in content type, or in one byte of text are distinguishable, and comparing
 * parsed objects would hide exactly the differences that matter.
 *
 * Unchanged, on purpose, and the body stays a raw string. This is the first of the
 * mechanisms that stop a future reader loosening the crown-jewel comparison: a parsed
 * comparison is not reachable from this helper at all, so loosening one would mean
 * hand-rolling `JSON.parse` in a test file, which the source scanner in
 * `../refusal-identity-guard.test.ts` fails on. Do not "improve" this into returning a
 * parsed object.
 *
 * No exclusion list, and none is needed. Measured on both protocol legs under `auto` /
 * `sse` / `json`: no SSE `id:` line is ever emitted, two identical requests are
 * byte-identical, and a foreign-org id is byte-identical to an id that does not exist.
 * The empty exclusion list is a property of the package, not a consequence of a framing
 * choice.
 *
 * `contentType` reads one of two bands and both are asserted:
 * `text/event-stream` where the SDK rendered the answer;
 * `application/json;charset=utf-8` where our own `refusalResponse` did,
 *  before the SDK was ever in the call stack (every 401, and the 405).
 * A third value exists and is not a band: a `202` notification answer carries NO
 * content-type at all, so a sweep over every response gets `null` there.
 */
export interface ResponseFingerprint {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

export async function fingerprint(response: Response): Promise<ResponseFingerprint> {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}

// Reading an SSE frame without parsing it

/**
 * The `data:` payloads of an SSE frame, in order, by string operations only.
 *
 * Under the pinned `responseMode: "sse"` every SDK-rendered answer arrives as `event:
 * message\ndata: {…}\n\n`, so a row that wants to assert on the JSON-RPC message rather
 * than on the whole frame needs the `data:` line out of it. `split` and `startsWith`,
 * never `JSON.parse`, never a regex that could be mistaken for one.
 *
 * Why this lives here rather than in each test file. Four separate test files need it,
 * and `JSON.parse(` is a banned token in all four (`../refusal-identity-guard.test.ts`
 * scans their source text for it). Four hand-rolled extractors is four chances for one
 * of them to reach for the obvious parse; one extractor here is one place to get it
 * right. The ruling says extraction happens "inside the test, never in the
 * helper". That sentence is about not letting a helper perform a parsed comparison,
 * which this does not do: it returns strings and compares nothing. Task 3.1 item 7
 * makes the placement explicit.
 *
 * Returns `[]` for a body that is not an SSE frame (a pre-SDK refusal, say) so a row
 * that reached for this on the wrong band gets an empty array it must assert about,
 * rather than a silently plausible string.
 */
export function sseDataLines(frame: string): readonly string[] {
  const payloads: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const payload = line.slice("data:".length);
    payloads.push(payload.startsWith(" ") ? payload.slice(1) : payload);
  }
  return payloads;
}

/**
 * The single `data:` payload of a one-message SSE frame.
 *
 * Throws when there is not exactly one, naming how many it found. An answer that
 * suddenly carries two messages, or none, should fail the row that assumed one rather
 * than silently compare against `undefined`.
 */
export function sseDataLine(frame: string): string {
  const payloads = sseDataLines(frame);
  if (payloads.length !== 1) {
    throw new Error(
      `mcp fixture: expected exactly one \`data:\` line in the SSE frame, found ${payloads.length}. Frame: ${JSON.stringify(frame)}`,
    );
  }
  return payloads[0] as string;
}
