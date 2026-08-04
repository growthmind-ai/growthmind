import type { CandidateFinding, DetectorCoverage, MeasuredCount } from "@growthmind/core";
import { candidateFindingSchema, measuredCount, traceEntry } from "@growthmind/core";
import {
  createApiKeysRepo,
  API_KEY_ACTOR_PREFIX,
  API_KEY_ACTOR_ROLE,
  type ScopedDb,
} from "@growthmind/db";
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

export const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
export const WINDOW_END = new Date("2026-06-08T00:00:00.000Z");

export const ORG_A = "org-mcp-a";
export const ORG_B = "org-mcp-b";

export const KEY_A = "mcp-fixture-key-org-a";
export const KEY_B = "mcp-fixture-key-org-b";

const KEPT = 25;
const REACHED = 25;
const LEFT = 12;

const CLEAN_COVERAGE: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

function coreCount(numerator: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: KEPT,
    unit: "sessions",
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: KEPT, kept: KEPT, setAside: [] },
  });
}

export function wireCount(numerator: number): McpMeasuredCount {
  return mcpMeasuredCountSchema.parse({
    numerator,
    denominator: KEPT,
    unit: "sessions",
    timeframe: { start: WINDOW_START.toISOString(), end: WINDOW_END.toISOString() },
    basis: { totalInWindow: KEPT, kept: KEPT, setAside: [] },
  });
}

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
    spec: { candidate: candidateFor(input.surface ?? "/mcp/reports"), signals: [] },
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
    summary: "People are leaving the reports page without going any further.",
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
    headline: "People are leaving the reports page without going any further.",
    detail:
      "We saw sessions reach the reports page and stop there. We are not saying why they stopped.",
    surface: { name: "the reports page", path: "/mcp/reports" },
    affected: wireCount(LEFT),
    firstSeenAt: WINDOW_START.toISOString(),
    lastSeenAt: WINDOW_END.toISOString(),
    evidence: [
      { kind: "session_replay", label: "A recording of one visit that stopped here.", url: null },
    ],
  };
}

export function credentialFor(organizationId: string): McpCredential {
  return {
    context: {
      userId: `${API_KEY_ACTOR_PREFIX}fixture-${organizationId}`,
      organizationId,
      organizationName: `Organization ${organizationId}`,
      role: API_KEY_ACTOR_ROLE,
    },
  };
}

export function fakeCredentials(byMaterial: Readonly<Record<string, string>>): McpCredentialSource {
  return {
    resolve(presented: string): Promise<McpCredential | null> {
      const organizationId = byMaterial[presented];
      return Promise.resolve(organizationId === undefined ? null : credentialFor(organizationId));
    },
  };
}

export interface MintedTestApiKey {
  readonly raw: string;
  readonly id: string;
}

export async function mintRealApiKey(
  db: ScopedDb,
  ctx: TenantContext,
  name: string,
): Promise<MintedTestApiKey> {
  const minted = await createApiKeysRepo(db, ctx).mint({ name });
  return { raw: minted.raw, id: minted.key.id };
}

export function throwingCredentials(): McpCredentialSource {
  return {
    resolve(): Promise<McpCredential | null> {
      return Promise.reject(new Error("mcp fixture: the credential store is unreachable"));
    },
  };
}

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
      organizationsAsked.push(query.principal.organizationId);

      const matching = openFixes.filter(
        (stored) =>
          stored.organizationId === query.principal.organizationId &&
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
      organizationsAsked.push(query.principal.organizationId);
      const found = fixes.find(
        (stored) =>
          stored.organizationId === query.principal.organizationId &&
          stored.record.fixId === query.fixId,
      );
      return Promise.resolve(found?.record ?? null);
    },

    getFinding(query: GetFindingQuery): Promise<FindingRecord | null> {
      organizationsAsked.push(query.principal.organizationId);
      const found = findings.find(
        (stored) =>
          stored.organizationId === query.principal.organizationId &&
          stored.record.findingId === query.findingId,
      );
      return Promise.resolve(found?.record ?? null);
    },
  };

  return { port, organizationsAsked };
}

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

export const MCP_URL = "http://localhost:3000/api/mcp";

export const WIRE_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
} as const;

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

export function sseDataLine(frame: string): string {
  const payloads = sseDataLines(frame);
  if (payloads.length !== 1) {
    throw new Error(
      `mcp fixture: expected exactly one \`data:\` line in the SSE frame, found ${payloads.length}. Frame: ${JSON.stringify(frame)}`,
    );
  }
  return payloads[0] as string;
}
