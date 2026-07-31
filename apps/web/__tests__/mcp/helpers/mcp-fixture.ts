// The fixture the MCP suites drive the REAL entry point with (O-009).
//
// WHAT THIS FILE IS AND IS NOT. It is a two-organization store behind the real
// `McpReadPort` interface, and a credential source behind the real
// `McpCredentialSource` interface. It is NOT a re-implementation of the route:
// every test calls `handleMcpRequest` with a real `Request` and asserts on a
// real `Response`, so what is proven is the handler's behaviour and not a
// replica's.
//
// THE FAKE READ PORT ENFORCES THE PORT'S OWN CONTRACT, deliberately. Its header
// requires that an implementation filter by organization in the SAME predicate
// as the id, so the fake does exactly that — one `find` over one condition,
// with no "look it up then check who owns it" step anywhere. A fake that
// checked ownership separately would be modelling the bug the contract forbids,
// and the cross-tenant suite would then be proving the fake rather than the
// route.
//
// FIXTURE TIME IS A CONSTANT. Nothing here reads a clock, so a rendered spec is
// the same string on every run and in every timezone.
//
// Lane prefix `mcp` — shared with no other suite.
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

// ---------------------------------------------------------------------------
// Frozen fixture time and identities
// ---------------------------------------------------------------------------

export const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
export const WINDOW_END = new Date("2026-06-08T00:00:00.000Z");

export const ORG_A = "org-mcp-a";
export const ORG_B = "org-mcp-b";

/** Presented credential material. Opaque strings: the fake credential source
 * matches them exactly, the way a real one matches a stored hash. */
export const KEY_A = "mcp-fixture-key-org-a";
export const KEY_B = "mcp-fixture-key-org-b";

const KEPT = 25;
const REACHED = 25;
const LEFT = 12;

const CLEAN_COVERAGE: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

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
 * The WIRE mirror of a count — parsed through `mcpMeasuredCountSchema`, so a
 * fixture cannot carry a count the contract would refuse and quietly make a
 * test pass on a shape production could never produce.
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

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * A `CandidateFinding` PARSED through its own schema, so no fixture here can
 * drift from the contract `renderFixSpec` is typed against. Shaped after the
 * funnel fixture in `packages/core/__tests__/fixes/fix-spec.test.ts`: two
 * counts in declared role order with different numerators.
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

// ---------------------------------------------------------------------------
// The fake credential source
// ---------------------------------------------------------------------------

/**
 * Presented material to organization, by exact match — the fake mirror of a
 * hash lookup. Anything not in the map resolves to `null`, which is the
 * fail-closed direction the port's contract requires.
 */
export function fakeCredentials(byMaterial: Readonly<Record<string, string>>): McpCredentialSource {
  return {
    resolve(presented: string): Promise<McpCredential | null> {
      const organizationId = byMaterial[presented];
      return Promise.resolve(organizationId === undefined ? null : { organizationId });
    },
  };
}

// ---------------------------------------------------------------------------
// A real credential, minted the way a person mints one
// ---------------------------------------------------------------------------

/** What a minted read credential gives a test: the material to present, and the
 * id to revoke it by. Never the hash — `MintedApiKey.key` carries no secret,
 * and neither does this. */
export interface MintedTestApiKey {
  readonly raw: string;
  readonly id: string;
}

/**
 * Mints a REAL `api_keys` row through the production repository — the same call
 * `scripts/mint-api-key.ts` makes, against a real database with real
 * migrations. This is deliberately NOT a fake: the suites that use it are
 * proving the production resolution path (`isApiKeyFormat`, the hash lookup,
 * the revocation predicate), which a hand-built row could not exercise.
 *
 * `apps/web` has no `drizzle-orm` and no `zod` dependency and must not gain
 * one, so every seeded credential in this lane goes through `@growthmind/db`'s
 * factories rather than through a query written here.
 */
export async function mintRealApiKey(
  db: ScopedDb,
  ctx: TenantContext,
  name: string,
): Promise<MintedTestApiKey> {
  const minted = await createApiKeysRepo(db, ctx).mint({ name });
  return { raw: minted.raw, id: minted.key.id };
}

/** A credential source that throws — the "credential store unreachable" path,
 * which must fail closed rather than open. */
export function throwingCredentials(): McpCredentialSource {
  return {
    resolve(): Promise<McpCredential | null> {
      return Promise.reject(new Error("mcp fixture: the credential store is unreachable"));
    },
  };
}

// ---------------------------------------------------------------------------
// The fake read port
// ---------------------------------------------------------------------------

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

/** Every organization id the handler asked this port about, in order. The
 * cross-tenant suite asserts this never contains an organization other than the
 * credential's. */
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

      // ONE PREDICATE, both conditions — the port contract's rule 1 and 3. A
      // project id belonging to another organization matches nothing here
      // because the organization condition is in the same test.
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

// ---------------------------------------------------------------------------
// Driving the real entry point
// ---------------------------------------------------------------------------

const MCP_URL = "http://localhost:3000/api/mcp";

/** A tool call as a real `Request`. `key` omitted means no credential at all. */
export function toolCallRequest(input: {
  tool: string;
  input?: unknown;
  key?: string | null;
}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (typeof input.key === "string") {
    headers.set("authorization", `Bearer ${input.key}`);
  }

  return new Request(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool: input.tool, input: input.input ?? {} }),
  });
}

/** A request whose body is not JSON at all. */
export function rawBodyRequest(body: string, key: string): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", authorization: `Bearer ${key}` }),
    body,
  });
}

/**
 * Everything about a response that a caller could tell two answers apart by.
 *
 * The identity assertions compare THIS, not a parsed body: two responses that
 * differ in status, in content type, or in one byte of text are
 * distinguishable, and comparing parsed objects would hide exactly the
 * differences that matter.
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
