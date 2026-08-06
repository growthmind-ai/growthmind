import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVIDENCE_SHAPE_VERSION,
  FIX_SPEC_PAYLOAD_VERSION,
  GATE_REASON_MESSAGES,
  PROOF_PREDICATE_VERSION,
  SIGNATURE_TUPLE_VERSION,
  THRESHOLD_RULE_SET_VERSION,
  candidateFindingSchema,
  measuredCount,
  renderFloorSummary,
  renderWithheldFloorSummary,
  reviewFindingText,
  scanResidualPii,
} from "@growthmind/core";
import type { CandidateFinding, MeasuredCount, SuppressionDecision, TraceEntry } from "@growthmind/core";
import { computeFindingSignature, signatureHex } from "@growthmind/db";
import type {
  AnalysisRunRecord,
  AnalysisRunsRepo,
  CloseRunInput,
  FindingPayloadRow,
  FindingPayloadsRepo,
  FindingRecord,
  FindingSignatureRecord,
  FindingsRepo,
  OpenRunResult,
  PersistFindingInput,
  RecordSignatureResult,
  ScannedText,
  SignatureHex,
  SignatureLedgerService,
  UpsertFindingPayloadInput,
} from "@growthmind/db";
import type { SessionSummariser, SummariseInput } from "@growthmind/adapters";
import type { SummaryRenderResult, SuppressionReasonCode, TenantContext } from "@growthmind/shared";
import { tenantContextSchema } from "@growthmind/shared";
import { expect, test } from "bun:test";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../packages/shared/__tests__/onboarding/module-under-construction";
import { planCandidate } from "../../src/analysis/plan";
import { tenantContextFor } from "../../src/analysis/types";
import type {
  AnalysisLane,
  AnalysisLaneDeps,
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
  AnalysisTickSummary,
  LaneTally,
} from "../../src/tasks/analysis-tick";
import { runAnalysisLane, runAnalysisTick } from "../../src/tasks/analysis-tick";

// ADD o-019-dismissal-wired Decision 5: `RunTally`/`LaneTally` gain a `suppressed`
// counter, in-memory/log-only (never persisted — the PRD's Data Requirements are
// explicit: no new columns). Not on the type yet, so declared locally as a TODO for
// production rather than imported.
type LaneTallyWithSuppressed = LaneTally & { readonly suppressed: number };

const TICK_AT = new Date("2026-08-01T09:00:00.000Z");
const WINDOW = {
  start: new Date("2026-07-25T00:00:00.000Z"),
  end: new Date("2026-08-01T00:00:00.000Z"),
};

const ORG = "o11-org";
const ORG_NAME = "Acme";
const PROJECT = "o11-project";
const MODEL_ID = "o11-model-under-test";

const ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE = 10_000;

const CLEAN_HEADLINE = "The payment step is losing sessions";
const CLEAN_CONTEXT = "Sessions reached the payment step and left without finishing.";

// Every expectation about persisted text stays inside the brand: comparing a `ScannedText`
// against a bare string would need a widening the sprint exists to prevent.
function scannedFixture(
  headline: string,
  context: readonly string[],
): { readonly headline: ScannedText; readonly context: readonly ScannedText[] } {
  const verdict = reviewFindingText({ headline, context });
  if (verdict.held) {
    throw new Error(`scannedFixture: the text given is held as ${verdict.why}`);
  }
  return { headline: verdict.headline, context: verdict.context };
}

const CLEAN_TEXT = scannedFixture(CLEAN_HEADLINE, [CLEAN_CONTEXT]);

const OFFENDING_CONTEXT = "47 people gave up because the payment form is broken.";

function count(numerator: number, kept: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: WINDOW,
    basis: { totalInWindow: kept, kept, keptUnchecked: 0, setAside: [] },
  });
}

function trace(): readonly TraceEntry[] {
  return [
    {
      class: "confusing",
      predicate: "confusing_struggle",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: true,
      reasonCode: "confusing_satisfied",
      reason: GATE_REASON_MESSAGES.confusing_satisfied,
    },
  ];
}

function candidate(surface: string): CandidateFinding {
  return candidateFindingSchema.parse({
    detector: "funnel_dropoff",
    claimedClass: "confusing",
    finalClass: "confusing",
    trace: trace(),
    counts: [count(28, 28), count(3, 28)],
    timeframe: WINDOW,
    claimSubject: "surface",
    surface,
    surfaceNormalisationVersion: 1,
    evidenceShape: `{"detector":"funnel_dropoff","surface":"${surface}","v":1}`,
    evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
    thresholdRuleSetVersion: THRESHOLD_RULE_SET_VERSION,
    ranking: { sampleSize: count(3, 28), confidenceBasis: "threshold_met" },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  });
}

function signatureIn(projectId: string, subject: CandidateFinding): string {
  return computeFindingSignature({
    projectId,
    surface: subject.surface,
    symptomClass: subject.finalClass,
    evidenceShape: subject.evidenceShape,
  });
}

function signatureOf(subject: CandidateFinding): string {
  return signatureIn(PROJECT, subject);
}

const CANDIDATE_A = candidate("/checkout/payment");
const CANDIDATE_B = candidate("/checkout/review");
const CANDIDATE_C = candidate("/signup/verify");

const LEAKED_TOKEN = "a1b2c3d4e5f6a7b8c9d0";
const CANDIDATE_LEAKY = candidate(`/reset-password/${LEAKED_TOKEN}`);

function unrenderableCandidate(surface: string): CandidateFinding {
  return candidateFindingSchema.parse({ ...candidate(surface), counts: [count(28, 28)] });
}

const CANDIDATE_UNRENDERABLE_A = unrenderableCandidate("/checkout/confirm");
const CANDIDATE_UNRENDERABLE_B = unrenderableCandidate("/checkout/thanks");

function lane(overrides: Partial<AnalysisLane> = {}): AnalysisLane {
  return {
    organizationId: ORG,
    organizationName: ORG_NAME,
    projectId: PROJECT,
    candidates: [CANDIDATE_A],
    sessionsConsidered: 42,
    ...overrides,
  };
}

function laneSource(lanes: readonly AnalysisLane[]): AnalysisLaneSource {
  return {
    listDueLanes: () => Promise.resolve(lanes),
     
    laneForProject: (projectId: string) =>
      Promise.resolve(lanes.find((row) => row.projectId === projectId) ?? null),
  };
}

interface CountingSummariser {
  port: SessionSummariser;
   
  calls: () => number;
   
  surfaces: () => readonly string[];
}

type SummariserBehaviour = (input: SummariseInput, callIndex: number) => Promise<SummaryRenderResult>;

function ok(headline: string, context: string): SummaryRenderResult {
  return {
    ok: true,
    headline,
    context,
    resolvedModelId: MODEL_ID,
    usage: { inputTokens: 900, outputTokens: 120 },
  };
}

function failed(code: "call_failed" | "output_invalid", message: string): SummaryRenderResult {
  return { ok: false, code, message, resolvedModelId: MODEL_ID, usage: {} };
}

function countingSummariser(behaviour: SummariserBehaviour): CountingSummariser {
  const seen: string[] = [];
  return {
    calls: () => seen.length,
    surfaces: () => [...seen],
    port: {
      render(input: SummariseInput): Promise<SummaryRenderResult> {
        const callIndex = seen.length;
        seen.push(input.surface);
        return behaviour(input, callIndex);
      },
    },
  };
}

const cleanSummariser = (): CountingSummariser =>
  countingSummariser(() => Promise.resolve(ok(CLEAN_HEADLINE, CLEAN_CONTEXT)));

interface FakeFindings {
  repoFor: (ctx: TenantContext) => FindingsRepo;
  rows: () => FindingRecord[];
  rowFor: (signature: string) => FindingRecord | undefined;

  breakOn: (signature: string) => void;

  persistCalls: () => readonly PersistFindingInput[];
}

function findingKey(organizationId: string, projectId: string, signature: string): string {
  return `${organizationId}|${projectId}|${signature}`;
}

function createFakeFindings(): FakeFindings {
  const stored = new Map<string, FindingRecord>();
  const broken = new Set<string>();
  const persistCalls: PersistFindingInput[] = [];
  let nextId = 1;

  return {
    rows: () => [...stored.values()],
    rowFor: (signature) => stored.get(findingKey(ORG, PROJECT, signature)),
    breakOn: (signature) => broken.add(signature),
    persistCalls: () => [...persistCalls],
    repoFor: (ctx) => ({

      persist(input: PersistFindingInput): Promise<FindingRecord> {
        persistCalls.push(input);
        if (broken.has(input.signature)) {
          return Promise.reject(new Error("o11-findings-store-unavailable"));
        }
        const key = findingKey(ctx.organizationId, input.projectId, input.signature);
        const existing = stored.get(key);
        if (existing) return Promise.resolve(existing);

        const row = {
          ...input,
          text: reviewFindingText({ headline: input.headline, context: input.context }),
          id: `o11-finding-${String(nextId)}`,
          organizationId: ctx.organizationId,
          createdAt: TICK_AT,
        } as unknown as FindingRecord;
        nextId += 1;
        stored.set(key, row);
        return Promise.resolve(row);
      },

      listForProject(projectId: string): Promise<FindingRecord[]> {
        return Promise.resolve(
          [...stored.values()].filter(
            (row) => row.organizationId === ctx.organizationId && row.projectId === projectId,
          ),
        );
      },

      findBySignature(projectId: string, signature: string): Promise<FindingRecord | null> {
        return Promise.resolve(
          stored.get(findingKey(ctx.organizationId, projectId, signature)) ?? null,
        );
      },

      findById(projectId: string, id: string): Promise<FindingRecord | null> {
        return Promise.resolve(
          [...stored.values()].find(
            (row) =>
              row.organizationId === ctx.organizationId &&
              row.projectId === projectId &&
              row.id === id,
          ) ?? null,
        );
      },
    }),
  };
}

interface FakeRuns {
  repoFor: (ctx: TenantContext) => AnalysisRunsRepo;
  rows: () => AnalysisRunRecord[];
   
  claimAttempts: () => readonly string[];
   
  claimed: () => readonly string[];
}

function createFakeRuns(): FakeRuns {
  const runs = new Map<string, AnalysisRunRecord>();
   
  const claims = new Set<string>();
  const attempts: string[] = [];
  let nextRunId = 1;

  function projectClaimCount(organizationId: string, projectId: string): number {
    return [...claims].filter((key) => key.startsWith(`${organizationId}|${projectId}|`)).length;
  }

  function organizationClaimCount(organizationId: string): number {
    return [...claims].filter((key) => key.startsWith(`${organizationId}|`)).length;
  }

  return {
    rows: () => [...runs.values()],
    claimAttempts: () => [...attempts],
    claimed: () => [...claims].map((key) => key.split("|")[2] ?? ""),
    repoFor: (ctx) => ({
      open(input: { projectId: string; tickAt: Date }): Promise<OpenRunResult> {
         
        const open = [...runs.values()].find(
          (row) =>
            row.organizationId === ctx.organizationId &&
            row.projectId === input.projectId &&
            row.status === "running",
        );
        if (open) return Promise.resolve({ opened: false, run: open } as OpenRunResult);

        const run = {
          id: `o11-run-${String(nextRunId)}`,
          organizationId: ctx.organizationId,
          projectId: input.projectId,
          status: "running",
          outcome: null,
          stopReason: null,
          startedAt: input.tickAt,
          finishedAt: null,
          failureReason: null,
          modelCallsAttempted: 0,
           
          candidatesUnrenderable: 0,
          candidatesRefused: 0,
          resolvedModelId: null,
          tokensIn: null,
          tokensOut: null,
          createdAt: input.tickAt,
        } as unknown as AnalysisRunRecord;
        nextRunId += 1;
        runs.set(run.id, run);
        return Promise.resolve({ opened: true, run } as OpenRunResult);
      },

      close(input: CloseRunInput): Promise<AnalysisRunRecord> {
        const existing = runs.get(input.runId);
        if (!existing) return Promise.reject(new Error(`no run ${input.runId} to close`));
        const closed = {
          ...existing,
          status: input.status,
          outcome: input.outcome,
          stopReason: input.stopReason,
          finishedAt: input.finishedAt,
          failureReason: input.failureReason ?? null,
          modelCallsAttempted: input.modelCallsAttempted,
           
          candidatesUnrenderable: input.candidatesUnrenderable,
          candidatesRefused: input.candidatesRefused,
          resolvedModelId: input.resolvedModelId,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
        } as unknown as AnalysisRunRecord;
        runs.set(closed.id, closed);
        return Promise.resolve(closed);
      },

      claimModelCall(input: {
        projectId: string;
        runId: string;
        signature: string;
        signatureVersion: number;
        projectCap: number;
        organizationCap: number;
        at: Date;
      }) {
        attempts.push(input.signature);
        const key = findingKey(ctx.organizationId, input.projectId, input.signature);
        if (claims.has(key)) {
          return Promise.resolve({ claimed: false as const, reason: "already_claimed" as const });
        }
         
        if (
          projectClaimCount(ctx.organizationId, input.projectId) >= input.projectCap ||
          organizationClaimCount(ctx.organizationId) >= input.organizationCap
        ) {
          return Promise.resolve({ claimed: false as const, reason: "cap_exhausted" as const });
        }
        claims.add(key);
        return Promise.resolve({ claimed: true as const });
      },
    }),
  };
}

interface FakeLedger {
  serviceFor: (ctx: TenantContext) => SignatureLedgerService;
  recorded: () => readonly string[];

  // ADD o-019-dismissal-wired Decision 5/3: a real, controllable `consultSignature`
  // replacing the old "must never be called" guard — the analysis lane now consults
  // it for every candidate. Un-named signatures deliver (the permissive default), so
  // existing tests that never call these two setters see no behaviour change.
  suppressSignature: (signature: string, reason?: SuppressionReasonCode) => void;
  throwOnConsult: (signature: string) => void;
}

function notThisLane(name: string): () => never {
  return () => {
    throw new Error(`the analysis tick must never call ${name}`);
  };
}

function createFakeLedger(): FakeLedger {
  const recorded: string[] = [];
  const suppressed = new Map<string, SuppressionReasonCode>();
  const consultThrows = new Set<string>();

  return {
    recorded: () => [...recorded],
    suppressSignature: (signature, reason = "dismissed") => {
      suppressed.set(signature, reason);
    },
    throwOnConsult: (signature) => {
      consultThrows.add(signature);
    },
    serviceFor: (ctx) => ({
      recordSignature(projectId: string, subject: CandidateFinding): Promise<RecordSignatureResult> {
        recorded.push(subject.surface);
        const signature = signatureHex("a1b2c3d4".repeat(8));
        const record = {
          id: `o11-signature-${subject.surface}`,
          organizationId: ctx.organizationId,
          projectId,
          signature,
          symptomClass: subject.finalClass,
          surface: subject.surface,
          signatureTupleVersion: 1,
          evidenceShapeVersion: subject.evidenceShapeVersion,
          surfaceNormalisationVersion: subject.surfaceNormalisationVersion,
          firstSeenAt: TICK_AT,
          lastSeenAt: TICK_AT,
          timesSeen: 1,
          deliveredAt: null,
          dismissedAt: null,
          createdAt: TICK_AT,
        } as unknown as FindingSignatureRecord;
        return Promise.resolve({ signature, record });
      },
      consultSignature(
        _projectId: string,
        input: CandidateFinding | SignatureHex,
      ): Promise<SuppressionDecision> {
        const signature = typeof input === "string" ? input : signatureOf(input);

        if (consultThrows.has(signature)) {
          return Promise.reject(
            new Error(`createFakeLedger: consultSignature refused for ${signature}`),
          );
        }

        const reason = suppressed.get(signature);
        if (reason !== undefined) {
          return Promise.resolve({ decision: "suppress", reason });
        }

        return Promise.resolve({ decision: "deliver", reason: "not_seen_before" });
      },
      markSignatureDelivered: notThisLane("markSignatureDelivered"),
      recordDismissal: notThisLane("recordDismissal"),
      recordAncestry: notThisLane("recordAncestry"),
    }),
  };
}

interface Harness {
  deps: AnalysisTickDeps;
  findings: FakeFindings;
  runs: FakeRuns;
  ledger: FakeLedger;
  summariser: CountingSummariser | null;
  logs: () => readonly string[];
  errors: () => readonly string[];
}

function recordingLogger(sink: string[], errorSink: string[]): AnalysisLogger {
  return {
    info: (message: string) => sink.push(message),
    warn: (message: string) => sink.push(message),
    error: (message: string) => {
      sink.push(message);
      errorSink.push(message);
    },
  };
}

function harness(options: {
  lanes?: readonly AnalysisLane[];
  summariser?: CountingSummariser | null;
  cap?: number;

  ledgerThrows?: boolean;
}): Harness {
  const findings = createFakeFindings();
  const runs = createFakeRuns();
  const ledger = createFakeLedger();
  const summariser = options.summariser === undefined ? cleanSummariser() : options.summariser;
  const sink: string[] = [];
  const errorSink: string[] = [];

  return {
    findings,
    runs,
    ledger,
    summariser,
    logs: () => [...sink],
    errors: () => [...errorSink],
    deps: {
      lanes: laneSource(options.lanes ?? [lane()]),
       
      summariser:
        summariser === null ? null : { port: summariser.port, resolvedModelId: MODEL_ID },
      findingsFor: findings.repoFor,
      runsFor: runs.repoFor,
      payloadsFor: createFakePayloads().repoFor,
      ledgerFor:
        options.ledgerThrows === true
          ? (ctx: TenantContext) => ({
              ...ledger.serviceFor(ctx),
              recordSignature: () => {
                throw new Error("o11-ledger-write-refused");
              },
            })
          : ledger.serviceFor,
      projectCap: options.cap === undefined ? 12 : options.cap,
       
      organizationCap: ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,

      now: () => TICK_AT,
      logger: recordingLogger(sink, errorSink),
    },
  };
}

function sourceFor(h: Harness, subject: CandidateFinding): string | undefined {
  return h.findings.rowFor(signatureOf(subject))?.summarySource;
}

async function sourceForBehaviour(behaviour: SummariserBehaviour): Promise<string | undefined> {
  const summariser = countingSummariser(behaviour);
  const h = harness({ summariser });
  await runAnalysisTick(h.deps);
  return sourceFor(h, CANDIDATE_A);
}

const TERMINAL: readonly string[] = ["completed", "failed"];

test("driving the analysis task with a working model persists a finding with summary_source model_rendered", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  const row = h.findings.rowFor(signatureOf(CANDIDATE_A));
  expect(row?.summarySource).toBe("model_rendered");
   
  expect(summariser.calls()).toBe(1);
   
  expect(row?.resolvedModelId).toBe(MODEL_ID);
   
  expect(h.ledger.recorded()).toEqual([CANDIDATE_A.surface]);
});

const COUPON_SURFACE = "/checkout/coupon";

const COUPON_SIGNAL = { kind: "clean_exit", surface: COUPON_SURFACE } as const;

// Parsed through the schema on purpose: today `signals` is stripped as an unknown key, so
// the assertion below is red until Wave 2 declares it and Wave 4 writes the row.
const CANDIDATE_WITH_SIGNALS = candidateFindingSchema.parse({
  ...candidate(COUPON_SURFACE),
  signals: [COUPON_SIGNAL],
});

interface FakePayloads {
  repoFor: (ctx: TenantContext) => FindingPayloadsRepo;
  rows: () => readonly FindingPayloadRow[];
}

function createFakePayloads(): FakePayloads {
  const stored: FindingPayloadRow[] = [];

  const find = (organizationId: string, findingId: string): FindingPayloadRow | undefined =>
    stored.find((row) => row.organizationId === organizationId && row.findingId === findingId);

  return {
    rows: () => [...stored],
    repoFor: (ctx) => ({
      upsertFor(input: UpsertFindingPayloadInput): Promise<FindingPayloadRow> {
        const existing = find(ctx.organizationId, input.findingId);
        if (existing) return Promise.resolve(existing);

        const row: FindingPayloadRow = {
          id: `o11-payload-${String(stored.length + 1)}`,
          organizationId: ctx.organizationId,
          findingId: input.findingId,
          payloadVersion: input.payload.payloadVersion,
          candidate: input.payload.candidate,
          signals: input.payload.signals,
          createdAt: TICK_AT,
        };
        stored.push(row);
        return Promise.resolve(row);
      },

      findForFinding(findingId: string): Promise<FindingPayloadRow | null> {
        return Promise.resolve(find(ctx.organizationId, findingId) ?? null);
      },
    }),
  };
}

test("persists the payload a fix spec needs alongside the finding", async () => {
  const payloads = createFakePayloads();
  const h = harness({ lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_WITH_SIGNALS] })] });

  const deps = { ...h.deps, payloadsFor: payloads.repoFor } as AnalysisTickDeps;

  await runAnalysisTick(deps);

  const persisted = h.findings.rows();
  expect(persisted).toHaveLength(2);
  expect(payloads.rows()).toHaveLength(persisted.length);

  const withSignals = h.findings.rowFor(signatureOf(CANDIDATE_WITH_SIGNALS));
  const row = payloads.rows().find((entry) => entry.findingId === withSignals?.id);

  expect(row?.payloadVersion).toBe(FIX_SPEC_PAYLOAD_VERSION);
  expect((row?.candidate as { detector?: unknown } | undefined)?.detector).toBe(
    CANDIDATE_WITH_SIGNALS.detector,
  );
  expect(row?.signals).toEqual([COUPON_SIGNAL]);
});

test("driving the analysis task with no key configured persists floor_no_key_configured and attempts zero model calls", async () => {
   
  const unreachable = cleanSummariser();
  const h = harness({ summariser: null });

  await runAnalysisTick(h.deps);

  expect(sourceFor(h, CANDIDATE_A)).toBe("floor_no_key_configured");
   
  expect(unreachable.calls()).toBe(0);
   
  expect(h.runs.claimed()).toEqual([]);
   
  expect(h.findings.rowFor(signatureOf(CANDIDATE_A))?.resolvedModelId).toBeNull();
});

test("driving the analysis task past the cap persists floor_cap_exhausted for the candidate after the limit", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    summariser,
    cap: 2,
  });

  await runAnalysisTick(h.deps);

  expect(h.findings.rows()).toHaveLength(3);
  expect(sourceFor(h, CANDIDATE_C)).toBe("floor_cap_exhausted");
   
  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  expect(sourceFor(h, CANDIDATE_B)).toBe("model_rendered");
});

test("driving the analysis task with unparseable model output persists floor_model_output_invalid", async () => {
   
  expect(
    await sourceForBehaviour(() =>
      Promise.resolve(failed("output_invalid", "the answer could not be read")),
    ),
  ).toBe("floor_model_output_invalid");

  expect(await sourceForBehaviour(() => Promise.resolve(ok("", CLEAN_CONTEXT)))).toBe(
    "floor_model_output_invalid",
  );
});

test("driving the analysis task with guard-rejected model text persists floor_model_text_rejected", async () => {
   
  const rejected = await sourceForBehaviour(() =>
    Promise.resolve(ok(CLEAN_HEADLINE, OFFENDING_CONTEXT)),
  );
  expect(rejected).toBe("floor_model_text_rejected");

  const invalid = await sourceForBehaviour(() =>
    Promise.resolve(failed("output_invalid", "the answer could not be read")),
  );
  expect(rejected).not.toBe(invalid);
  expect([rejected, invalid]).toEqual(["floor_model_text_rejected", "floor_model_output_invalid"]);

  expect(await sourceForBehaviour(() => Promise.resolve(ok(CLEAN_HEADLINE, CLEAN_CONTEXT)))).toBe(
    "model_rendered",
  );
});

test("driving the analysis task with a failing model call persists floor_model_call_failed", async () => {
  const summariser = countingSummariser(() =>
    Promise.resolve(failed("call_failed", "we could not reach the model")),
  );
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  expect(sourceFor(h, CANDIDATE_A)).toBe("floor_model_call_failed");
   
  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A)]);
});

test("with cap N and N plus one eligible candidates exactly N model calls occur in deterministic order", async () => {
  const CAP = 2;
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    summariser,
    cap: CAP,
  });

  await runAnalysisTick(h.deps);

  expect(summariser.calls()).toBe(CAP);
   
  expect(summariser.surfaces()).toEqual([
    CANDIDATE_A.surface,
    CANDIDATE_B.surface,
  ]);
   
  expect(h.runs.claimAttempts()).toEqual([
    signatureOf(CANDIDATE_A),
    signatureOf(CANDIDATE_B),
    signatureOf(CANDIDATE_C),
  ]);
  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A), signatureOf(CANDIDATE_B)]);
});

test("cap exhaustion records stop_reason cap_exhausted and never presents as ran_to_completion", async () => {
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    cap: 2,
  });

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.stopReason).toBe("cap_exhausted");
   
  expect(run?.stopReason).not.toBe("ran_to_completion");
   
  expect(run?.status).toBe("completed");
  expect(run?.outcome).toBe("produced_findings");
  expect(run?.outcome).not.toBe("no_candidates_passed_gate");
   
  const roomy = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    cap: 12,
  });
  await runAnalysisTick(roomy.deps);
  expect(roomy.runs.rows()[0]?.stopReason).toBe("ran_to_completion");
});

test("the happy path leaves the run row completed", async () => {
  const h = harness({ lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B] })] });

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).toBe("completed");
  expect(run?.finishedAt).toEqual(TICK_AT);
  expect(run?.failureReason).toBeNull();
   
  expect(run?.modelCallsAttempted).toBe(2);
  expect(run?.resolvedModelId).toBe(MODEL_ID);
});

test("a thrown model error leaves the run row terminal and never running", async () => {
   
  const summariser = countingSummariser(() => {
    throw new Error("o11-summariser-contract-violation");
  });
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).not.toBe("running");
  expect(TERMINAL).toContain(String(run?.status));
  expect(run?.finishedAt).not.toBeNull();
   
  const row = h.findings.rowFor(signatureOf(CANDIDATE_A));
  expect(row).toBeDefined();
  expect(String(row?.summarySource)).toStartWith("floor_");
   
  expect(String(run?.failureReason ?? "")).not.toContain("o11-summariser-contract-violation");
});

test("a mid-run persistence failure leaves the run row terminal and corrupts no finding row", async () => {
  const h = harness({ lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })] });
   
  h.findings.breakOn(signatureOf(CANDIDATE_B));

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).toBe("failed");
  expect(run?.status).not.toBe("running");
  expect(run?.finishedAt).not.toBeNull();
   
  const reason = String(run?.failureReason ?? "");
  expect(reason.length).toBeGreaterThan(0);
  expect(reason).not.toContain("o11-findings-store-unavailable");

  const first = h.findings.rowFor(signatureOf(CANDIDATE_A));
  expect(first?.summarySource).toBe("model_rendered");
  expect(first?.text).toEqual({ held: false, ...CLEAN_TEXT });
  expect(h.findings.rowFor(signatureOf(CANDIDATE_B))).toBeUndefined();
});

test("a retried task run does not double-persist findings or double-consume the cap", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B] })],
    summariser,
    cap: 12,
  });

  await runAnalysisTick(h.deps);
  const callsAfterFirst = summariser.calls();
  await runAnalysisTick(h.deps);

  expect(h.findings.rows()).toHaveLength(2);
  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  expect(sourceFor(h, CANDIDATE_B)).toBe("model_rendered");

  expect(callsAfterFirst).toBe(2);
  expect(summariser.calls()).toBe(2);
  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A), signatureOf(CANDIDATE_B)]);

  for (const run of h.runs.rows()) {
    expect(run.status).not.toBe("running");
    expect(TERMINAL).toContain(String(run.status));
  }
});

test("a candidate whose surface is not normalised is refused before any model call or cap claim", async () => {
  const summariser = cleanSummariser();
   
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_LEAKY, CANDIDATE_A] })],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  expect(summariser.surfaces()).toEqual([CANDIDATE_A.surface]);
  expect(summariser.calls()).toBe(1);

  expect(h.runs.claimAttempts()).toEqual([signatureOf(CANDIDATE_A)]);
  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A)]);

  expect(() => signatureOf(CANDIDATE_LEAKY)).toThrow();
  expect(h.findings.rows().some((row) => row.surface === CANDIDATE_LEAKY.surface)).toBe(false);
  expect(h.findings.rows()).toHaveLength(1);
   
  expect(h.ledger.recorded()).toEqual([CANDIDATE_A.surface]);

  for (const line of h.logs()) {
    expect(line).not.toContain(LEAKED_TOKEN);
    expect(line).not.toContain(CANDIDATE_LEAKY.surface);
  }
   
  expect(
    h.logs().some(
      (line) =>
        line.includes(PROJECT) && line.includes("not in the form this product stores"),
    ),
  ).toBe(true);

  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  const [run] = h.runs.rows();
  expect(run?.status).toBe("completed");
  expect(run?.stopReason).toBe("ran_to_completion");

  expect(summary.candidatesRefused).toBe(1);
  expect(summary.candidatesUnrenderable).toBe(0);
  expect(summary.findingsPersisted).toBe(1);
});

test("the surfaces every other test in this file drives are accepted by the gate", async () => {
   
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  expect(summary.candidatesRefused).toBe(0);
   
  expect(summariser.surfaces()).toEqual([
    CANDIDATE_A.surface,
    CANDIDATE_B.surface,
    CANDIDATE_C.surface,
  ]);
  expect(h.findings.rows()).toHaveLength(3);
});

const INCUMBENT_STARTED_AT = new Date(TICK_AT.getTime() - 5 * 60 * 1000);

const OTHER_WORKER: TenantContext = tenantContextSchema.parse({
  userId: "system:o11-other-analysis-tick",
  organizationId: ORG,
  organizationName: ORG_NAME,
  role: "system",
});

test("a project another run already holds is left untouched, terminal write included", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });

  const seeded = await h.runs.repoFor(OTHER_WORKER).open({
    projectId: PROJECT,
    tickAt: INCUMBENT_STARTED_AT,
  });
  expect(seeded.opened).toBe(true);
  const incumbent = seeded.run;

  const summary = await runAnalysisTick(h.deps);

  const rows = h.runs.rows();
  expect(rows).toHaveLength(1);
  const after = rows[0];
  expect(after?.id).toBe(incumbent.id);
  expect(after?.status).toBe("running");
  expect(after?.startedAt).toEqual(INCUMBENT_STARTED_AT);
  expect(after?.finishedAt).toBeNull();
  expect(after?.outcome).toBeNull();
  expect(after?.stopReason).toBeNull();
  expect(after?.failureReason).toBeNull();
  expect(after?.modelCallsAttempted).toBe(0);
  expect(after?.resolvedModelId).toBeNull();

  expect(summariser.calls()).toBe(0);
   
  expect(h.runs.claimAttempts()).toEqual([]);
  expect(h.runs.claimed()).toEqual([]);
   
  expect(h.findings.rows()).toEqual([]);
  expect(h.ledger.recorded()).toEqual([]);

  expect(summary.lanesConsidered).toBe(1);
  expect(summary.lanesAlreadyRunning).toBe(1);
  expect(summary.lanesRun).toBe(0);
  expect(summary.lanesFailed).toBe(0);
  expect(summary.lanesErrored).toBe(0);

  const unheld = cleanSummariser();
  const free = harness({ summariser: unheld });
  await runAnalysisTick(free.deps);
  expect(unheld.calls()).toBe(1);
  expect(free.runs.claimed()).toEqual([signatureOf(CANDIDATE_A)]);
  expect(sourceFor(free, CANDIDATE_A)).toBe("model_rendered");
  expect(free.runs.rows()[0]?.status).toBe("completed");
});

const QUIET_PROJECT = "o11-project-quiet";
 
const UNVISITED_PROJECT = "o11-project-unvisited";

test("a run that found nothing records which nothing it found, and the two zeros never collapse", async () => {
  const summariser = cleanSummariser();
   
  const h = harness({
    lanes: [
      lane({ projectId: QUIET_PROJECT, candidates: [], sessionsConsidered: 42 }),
      lane({ projectId: UNVISITED_PROJECT, candidates: [], sessionsConsidered: 0 }),
    ],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  const runFor = (projectId: string) => h.runs.rows().find((row) => row.projectId === projectId);
  const quiet = runFor(QUIET_PROJECT)?.outcome;
  const unvisited = runFor(UNVISITED_PROJECT)?.outcome;

  expect([quiet, unvisited]).toEqual(["no_candidates_passed_gate", "no_sessions_to_analyse"]);
  expect(quiet).not.toBe(unvisited);
   
  expect(quiet).not.toBe("produced_findings");
  expect(unvisited).not.toBe("produced_findings");

  for (const projectId of [QUIET_PROJECT, UNVISITED_PROJECT]) {
    const run = runFor(projectId);
    expect(run?.status).toBe("completed");
    expect(run?.status).not.toBe("running");
    expect(run?.finishedAt).toEqual(TICK_AT);
    expect(run?.stopReason).toBe("ran_to_completion");
    expect(run?.failureReason).toBeNull();
  }

  expect(summary.lanesRun).toBe(2);
  expect(summary.findingsPersisted).toBe(0);
  expect(h.findings.rows()).toEqual([]);
  expect(summariser.calls()).toBe(0);
});

test("candidates that produced no finding are recorded on the run row, with the floor's refusal kept apart from the gate's", async () => {
   
  const h = harness({
    lanes: [
      lane({
        candidates: [
          CANDIDATE_UNRENDERABLE_A,
          CANDIDATE_UNRENDERABLE_B,
          CANDIDATE_LEAKY,
          CANDIDATE_A,
        ],
      }),
    ],
    summariser: null,
  });

  const summary = await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect([run?.candidatesUnrenderable, run?.candidatesRefused]).toEqual([2, 1]);
   
  expect(summary.candidatesUnrenderable).toBe(2);
  expect(summary.candidatesRefused).toBe(1);

  expect(h.findings.rowFor(signatureOf(CANDIDATE_UNRENDERABLE_A))).toBeUndefined();
  expect(h.findings.rowFor(signatureOf(CANDIDATE_UNRENDERABLE_B))).toBeUndefined();
   
  expect(h.findings.rows().some((row) => row.surface === CANDIDATE_LEAKY.surface)).toBe(false);
   
  expect(sourceFor(h, CANDIDATE_A)).toBe("floor_no_key_configured");
  expect(run?.status).toBe("completed");

  const allLost = harness({
    lanes: [lane({ candidates: [CANDIDATE_UNRENDERABLE_A] })],
    summariser: null,
  });
  const lostSummary = await runAnalysisTick(allLost.deps);
  const [lostRun] = allLost.runs.rows();

  expect(allLost.findings.rows()).toEqual([]);
  expect(lostSummary.findingsPersisted).toBe(0);
  expect(lostRun?.status).toBe("completed");
  expect(lostRun?.outcome).toBe("produced_findings");
  expect(lostRun?.stopReason).toBe("ran_to_completion");
   
  expect(lostRun?.candidatesUnrenderable).toBe(1);
  expect(lostRun?.candidatesRefused).toBe(0);

  const clean = harness({ lanes: [lane({ candidates: [CANDIDATE_A] })], summariser: null });
  await runAnalysisTick(clean.deps);
  const [cleanRun] = clean.runs.rows();
  expect(cleanRun?.candidatesUnrenderable).toBe(0);
  expect(cleanRun?.candidatesRefused).toBe(0);
  expect(clean.findings.rows()).toHaveLength(1);
});

test("a summariser that throws still attributes the model it addressed on both the finding and the run", async () => {
   
  const summariser = countingSummariser(() => {
    throw new Error("o11-summariser-contract-violation");
  });
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  const row = h.findings.rowFor(signatureOf(CANDIDATE_A));
  expect(row?.summarySource).toBe("floor_model_call_failed");
  expect(row?.resolvedModelId).toBe(MODEL_ID);
  expect(row?.resolvedModelId).not.toBeNull();

  const [run] = h.runs.rows();
  expect(run?.modelCallsAttempted).toBe(1);
  expect(run?.resolvedModelId).toBe(MODEL_ID);
  expect(run?.resolvedModelId).not.toBeNull();

  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A)]);

  const noKey = harness({ summariser: null });
  await runAnalysisTick(noKey.deps);
  expect(noKey.findings.rowFor(signatureOf(CANDIDATE_A))?.resolvedModelId).toBeNull();
  expect(noKey.runs.rows()[0]?.modelCallsAttempted).toBe(0);
  expect(noKey.runs.rows()[0]?.resolvedModelId).toBeNull();
});

const OTHER_PROJECT = "o11-project-elsewhere";

const SECOND_TICK_AT = new Date(TICK_AT.getTime() + 60 * 60 * 1000);

function nextTick(h: Harness, at: Date, lanes: readonly AnalysisLane[]): AnalysisTickDeps {
  return { ...h.deps, lanes: laneSource(lanes), now: () => at };
}

function canEnterAPermanentIdentity(subject: CandidateFinding): boolean {
  try {
    signatureOf(subject);
    return true;
  } catch {
    return false;
  }
}

test("the signature the walker derives for a candidate is the one computeFindingSignature produces", async () => {
   
  const h = harness({
    lanes: [
      lane({ candidates: [CANDIDATE_A, CANDIDATE_B] }),
      lane({ projectId: OTHER_PROJECT, candidates: [CANDIDATE_A] }),
    ],
  });

  await runAnalysisTick(h.deps);

  const persisted = h.findings.rows();
  expect(persisted.map((row) => row.signature)).toEqual([
    signatureIn(PROJECT, CANDIDATE_A),
    signatureIn(PROJECT, CANDIDATE_B),
    signatureIn(OTHER_PROJECT, CANDIDATE_A),
  ]);

  expect(new Set(persisted.map((row) => row.signature)).size).toBe(3);
  expect(signatureIn(PROJECT, CANDIDATE_A)).not.toBe(signatureIn(OTHER_PROJECT, CANDIDATE_A));

  expect(persisted.map((row) => row.signatureVersion)).toEqual([
    SIGNATURE_TUPLE_VERSION,
    SIGNATURE_TUPLE_VERSION,
    SIGNATURE_TUPLE_VERSION,
  ]);

  expect(h.runs.claimAttempts()).toEqual(persisted.map((row) => row.signature));

  for (const row of persisted) {
    expect(row.signature).toMatch(/^[\da-f]{64}$/);
  }
});

test("the same candidate derives the same signature across two ticks with different instants and different orderings", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B] })],
    summariser,
    cap: 12,
  });

  await runAnalysisTick(h.deps);

  const idsAfterFirst = new Map(h.findings.rows().map((row) => [row.signature, row.id]));
  expect([...idsAfterFirst.keys()]).toEqual([signatureOf(CANDIDATE_A), signatureOf(CANDIDATE_B)]);
  expect(summariser.calls()).toBe(2);

  await runAnalysisTick(
    nextTick(h, SECOND_TICK_AT, [
      lane({ candidates: [CANDIDATE_B, CANDIDATE_C, CANDIDATE_A] }),
    ]),
  );

  const runs = h.runs.rows();
  expect(runs).toHaveLength(2);
  expect(runs[0]?.finishedAt).toEqual(TICK_AT);
  expect(runs[1]?.startedAt).toEqual(SECOND_TICK_AT);
  expect(runs[1]?.finishedAt).toEqual(SECOND_TICK_AT);
   
  expect(h.runs.claimAttempts().slice(2)).toEqual([
    signatureOf(CANDIDATE_B),
    signatureOf(CANDIDATE_C),
    signatureOf(CANDIDATE_A),
  ]);

  expect(h.runs.claimed()).toEqual([
    signatureOf(CANDIDATE_A),
    signatureOf(CANDIDATE_B),
    signatureOf(CANDIDATE_C),
  ]);

  expect(h.findings.rows()).toHaveLength(3);
  expect(h.findings.rowFor(signatureOf(CANDIDATE_A))?.id).toBe(
    idsAfterFirst.get(signatureOf(CANDIDATE_A)),
  );
  expect(h.findings.rowFor(signatureOf(CANDIDATE_B))?.id).toBe(
    idsAfterFirst.get(signatureOf(CANDIDATE_B)),
  );

  expect(summariser.calls()).toBe(3);
  expect(summariser.surfaces()).toEqual([
    CANDIDATE_A.surface,
    CANDIDATE_B.surface,
    CANDIDATE_C.surface,
  ]);
  expect(h.findings.rowFor(signatureOf(CANDIDATE_C))?.summarySource).toBe("model_rendered");

  for (const run of runs) {
    expect(TERMINAL).toContain(String(run.status));
  }
});

test("a ledger that throws still leaves the finding persisted and the run completed", async () => {
  const h = harness({ ledgerThrows: true });

  const summary = await runAnalysisTick(h.deps);

  // The finding is the load-bearing record; the signature is a dedup cache written
  // after it. A cache write must never cost the run its terminal state.
  expect(h.findings.rowFor(signatureOf(CANDIDATE_A))).toBeDefined();
  expect(summary.lanesErrored).toBe(0);

  // Not TERMINAL: `failed` is terminal too, so this would pass on a run the ledger
  // throw had aborted — which is the regression the test is named for.
  const closed = h.runs.rows().filter((row) => row.status === "completed");
  expect(closed.length).toBeGreaterThan(0);

  expect(
    h.logs().some((line) => line.includes("its identity could not be filed")),
  ).toBe(true);
  expect(h.logs().some((line) => line.includes("o11-ledger-write-refused"))).toBe(true);
});

test("a candidate whose surface cannot enter a permanent identity is refused without aborting the run", async () => {
   
  expect(canEnterAPermanentIdentity(CANDIDATE_LEAKY)).toBe(false);
   
  for (const accepted of [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C]) {
    expect(canEnterAPermanentIdentity(accepted)).toBe(true);
  }

  const summariser = cleanSummariser();
   
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_LEAKY, CANDIDATE_B] })],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  expect(sourceFor(h, CANDIDATE_B)).toBe("model_rendered");
  expect(summariser.surfaces()).toEqual([CANDIDATE_A.surface, CANDIDATE_B.surface]);
  expect(h.findings.rows()).toHaveLength(2);

  const [run] = h.runs.rows();
  expect(TERMINAL).toContain(String(run?.status));
  expect(run?.status).toBe("completed");
  expect(run?.stopReason).toBe("ran_to_completion");
  expect(run?.failureReason).toBeNull();
  expect(run?.finishedAt).toEqual(TICK_AT);

  expect([run?.candidatesRefused, run?.candidatesUnrenderable]).toEqual([1, 0]);
  expect(summary.candidatesRefused).toBe(1);
  expect(summary.candidatesUnrenderable).toBe(0);
  expect(summary.findingsPersisted).toBe(2);

  const walked = [CANDIDATE_A, CANDIDATE_LEAKY, CANDIDATE_B];
  expect(h.runs.claimAttempts()).toEqual(
    walked.filter(canEnterAPermanentIdentity).map((subject) => signatureOf(subject)),
  );
});

test("the analysis lane port carries candidate findings and no separate key", async () => {
   
  const wrapped: AnalysisLane["candidates"] = [
    // @ts-expect-error: a lane item is a CandidateFinding, never a
     
    { candidateKey: "o11-supplied-key", candidate: CANDIDATE_A },
  ];
  expect(wrapped).toHaveLength(1);

  const keyedLane: AnalysisLane = {
    ...lane(),
    // @ts-expect-error: the lane carries no key of its own either.
    candidateKey: "o11-supplied-key",
  };
  expect(keyedLane.projectId).toBe(PROJECT);

  const carried = lane().candidates;
  expect(carried).toEqual([CANDIDATE_A]);
  expect(candidateFindingSchema.parse(carried[0])).toEqual(CANDIDATE_A);
  expect(
    candidateFindingSchema.parse({ ...CANDIDATE_A, candidateKey: "o11-supplied-key" }),
  ).not.toHaveProperty("candidateKey");

  const h = harness({ lanes: [lane()] });

  await runAnalysisTick(h.deps);

  expect(h.runs.claimAttempts()).toEqual([signatureOf(CANDIDATE_A)]);
  expect(h.findings.rows().map((row) => row.signature)).toEqual([signatureOf(CANDIDATE_A)]);
});

const HELD_PROJECT = "o11-project-held";
const BREAKING_PROJECT = "o11-project-breaking";

test("runAnalysisTick produces the same summary after runAnalysisLane is extracted", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    summariser,
    lanes: [
       
      lane(),
       
      lane({ projectId: HELD_PROJECT }),
       
      lane({
        projectId: BREAKING_PROJECT,
        candidates: [CANDIDATE_LEAKY, CANDIDATE_B],
        sessionsConsidered: 30,
      }),
    ],
  });

  await h.runs.repoFor(OTHER_WORKER).open({
    projectId: HELD_PROJECT,
    tickAt: INCUMBENT_STARTED_AT,
  });
   
  h.findings.breakOn(signatureIn(BREAKING_PROJECT, CANDIDATE_B));

  const summary = await runAnalysisTick(h.deps);

  expect(summary).toEqual({
    lanesConsidered: 3,
     
    lanesRun: 2,
    lanesAlreadyRunning: 1,
    lanesFailed: 1,
    lanesErrored: 0,
    findingsPersisted: 1,
    candidatesUnrenderable: 0,
     
    candidatesRefused: 1,
     
    modelCallsAttempted: 2,
  } satisfies AnalysisTickSummary);

  expect(h.findings.rows()).toHaveLength(1);
  expect(
    h.runs
      .rows()
      .filter((row) => row.status === "running")
      .map((row) => row.projectId),
  ).toEqual([HELD_PROJECT]);
});

test("runAnalysisLane returns its tally rather than mutating a shared summary", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });

  expect(runAnalysisLane).toHaveLength(3);

  const { lanes: _tickOnlySource, ...laneOnlyDeps } = h.deps;
  const deps: AnalysisLaneDeps = laneOnlyDeps;

  const result = await runAnalysisLane(deps, lane(), TICK_AT);

  expect(result.outcome).toBe("completed");
  expect(result.tally).toEqual({
    findingsPersisted: 1,
    unrenderable: 0,
    refused: 0,
    suppressed: 0,
    modelCallsAttempted: 1,
  });

  expect(h.findings.rows()).toHaveLength(1);
  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  const closed = h.runs.rows()[0];
  expect(closed?.status).toBe("completed");
  expect(closed?.modelCallsAttempted).toBe(result.tally.modelCallsAttempted);
  expect(closed?.candidatesRefused).toBe(result.tally.refused);
  expect(closed?.candidatesUnrenderable).toBe(result.tally.unrenderable);

  const held = harness({ summariser: cleanSummariser() });
  await held.runs.repoFor(OTHER_WORKER).open({ projectId: PROJECT, tickAt: INCUMBENT_STARTED_AT });
  const { lanes: _heldTickOnlySource, ...heldLaneOnlyDeps } = held.deps;

  const blocked = await runAnalysisLane(heldLaneOnlyDeps, lane(), TICK_AT);

  expect(blocked.outcome).toBe("already_running");
  expect(blocked.tally).toEqual({
    findingsPersisted: 0,
    unrenderable: 0,
    refused: 0,
    suppressed: 0,
    modelCallsAttempted: 0,
  });

  expect(held.runs.rows()).toHaveLength(1);
  expect(held.runs.rows()[0]?.status).toBe("running");
});

test("runAnalysisLane does not write up a candidate whose signature the ledger resolves as dismissed", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });
  h.ledger.suppressSignature(signatureOf(CANDIDATE_A));

  const { lanes: _tickOnlySource, ...laneOnlyDeps } = h.deps;
  const deps: AnalysisLaneDeps = laneOnlyDeps;

  const result = await runAnalysisLane(deps, lane(), TICK_AT);

  expect(result.outcome).toBe("completed");
  expect(h.findings.rowFor(signatureOf(CANDIDATE_A))).toBeUndefined();
  expect(result.tally.findingsPersisted).toBe(0);
  expect((result.tally as LaneTallyWithSuppressed).suppressed).toBe(1);

  // Cost containment: a dismissed candidate never reaches the model.
  expect(summariser.calls()).toBe(0);
});

test("does not write up a candidate when consultSignature throws", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });
  h.ledger.throwOnConsult(signatureOf(CANDIDATE_A));

  const { lanes: _tickOnlySource, ...laneOnlyDeps } = h.deps;
  const deps: AnalysisLaneDeps = laneOnlyDeps;

  const result = await runAnalysisLane(deps, lane(), TICK_AT);

  expect(result.outcome).toBe("completed");
  expect(h.findings.rowFor(signatureOf(CANDIDATE_A))).toBeUndefined();

  // A thrown consult is not a resolved suppress decision (ADD Decision 3/5) — it lands
  // in the existing `refused` bucket, the same shape as `identityFor`'s own failure
  // mode, never the new `suppressed` counter.
  expect(result.tally.refused).toBe(1);
  expect((result.tally as LaneTallyWithSuppressed).suppressed ?? 0).toBe(0);
});

const PLANTED_CREDENTIAL = "sk-plantedbyatestneverarealkey";
const PLANTED_CREDENTIAL_KIND = "credential";

// A dotted offender (an email, an IP) cannot reach this seam: `splitSentences` refuses a
// full stop followed by anything but a capital, so the candidate never gets past
// `guardModelText` and the degrade would be attributed to segmentation instead.
const DIRTY_MODEL_CONTEXT =
  `Sessions reached the payment step and left without finishing. ` +
  `One session carried the value ${PLANTED_CREDENTIAL} through the form.`;

const DIRTY_FLOOR_SURFACE = "/orders-123456789012";
const DIRTY_FLOOR_KIND = "payment_card";
const CANDIDATE_FLOOR_DIRTY = candidate(DIRTY_FLOOR_SURFACE);

const FLOOR_AFTER_REJECTION = renderFloorSummary({
  candidate: CANDIDATE_A,
  source: "floor_model_text_rejected",
});

const FLOOR_AFTER_REJECTION_TEXT = scannedFixture(
  FLOOR_AFTER_REJECTION.headline,
  FLOOR_AFTER_REJECTION.context,
);

const dirtySummariser = (): CountingSummariser =>
  countingSummariser(() => Promise.resolve(ok(CLEAN_HEADLINE, DIRTY_MODEL_CONTEXT)));

test("a candidate whose model text contains a planted PII offender persists the floor summary with summary_source floor_model_text_rejected, never the dirty text", async () => {
  expect(scanResidualPii(DIRTY_MODEL_CONTEXT).clean).toBe(false);

  const h = harness({ summariser: dirtySummariser() });

  await runAnalysisTick(h.deps);

  const calls = h.findings.persistCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.summarySource).toBe("floor_model_text_rejected");
  expect(calls[0]?.headline).toBe(FLOOR_AFTER_REJECTION_TEXT.headline);
  expect(calls[0]?.context).toEqual(FLOOR_AFTER_REJECTION_TEXT.context);

  for (const call of calls) {
    expect(JSON.stringify(call)).not.toContain(PLANTED_CREDENTIAL);
  }
});

test("a candidate whose model text is clean persists model_rendered unchanged", async () => {
  expect(scanResidualPii(`${CLEAN_HEADLINE}\n${CLEAN_CONTEXT}`).clean).toBe(true);

  const h = harness({ summariser: cleanSummariser() });

  await runAnalysisTick(h.deps);

  const calls = h.findings.persistCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.summarySource).toBe("model_rendered");
  expect(calls[0]?.headline).toBe(CLEAN_TEXT.headline);
  expect(calls[0]?.context).toEqual(CLEAN_TEXT.context);
});

const WITHHELD_FLOOR = renderWithheldFloorSummary("floor_no_key_configured");

const WITHHELD_FLOOR_TEXT = scannedFixture(WITHHELD_FLOOR.headline, WITHHELD_FLOOR.context);

test("a candidate whose floor text itself is dirty records the finding with the words withheld and logs at error level", async () => {
  const floor = renderFloorSummary({
    candidate: CANDIDATE_FLOOR_DIRTY,
    source: "floor_no_key_configured",
  });
  const floorScan = scanResidualPii([floor.headline, ...floor.context].join("\n"));
  expect(floorScan.clean).toBe(false);
  expect(floorScan.findings[0]?.kind).toBe(DIRTY_FLOOR_KIND);

  const planned = harness({
    lanes: [lane({ candidates: [CANDIDATE_FLOOR_DIRTY] })],
    summariser: null,
  });
  const opened = await planned.runs.repoFor(OTHER_WORKER).open({
    projectId: PROJECT,
    tickAt: TICK_AT,
  });

  const dirtyLane = lane({ candidates: [CANDIDATE_FLOOR_DIRTY] });
  const plan = await planCandidate(
    planned.deps,
    dirtyLane,
    planned.runs.repoFor(OTHER_WORKER),
    planned.findings.repoFor(OTHER_WORKER),
    opened.run,
    CANDIDATE_FLOOR_DIRTY,
    1,
    TICK_AT,
    planned.deps.ledgerFor(tenantContextFor(dirtyLane)),
  );

  expect(plan.action.kind).toBe("persist");

  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_FLOOR_DIRTY] })],
    summariser: null,
  });
  const summary = await runAnalysisTick(h.deps);

  const calls = h.findings.persistCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.summarySource).toBe("floor_no_key_configured");
  expect(calls[0]?.headline).toBe(WITHHELD_FLOOR_TEXT.headline);
  expect(calls[0]?.context).toEqual(WITHHELD_FLOOR_TEXT.context);

  // The counts, the surface and the evidence shape are what a later re-render and every
  // reader are built from, so the hold must cost the words and nothing else.
  expect(calls[0]?.counts.map((row) => [row.numerator, row.denominator])).toEqual(
    CANDIDATE_FLOOR_DIRTY.counts.map((row) => [row.numerator, row.denominator]),
  );
  expect(calls[0]?.surface).toBe(DIRTY_FLOOR_SURFACE);
  expect(calls[0]?.evidenceShape).toBe(CANDIDATE_FLOOR_DIRTY.evidenceShape);
  expect(calls[0]?.signature).toBe(signatureOf(CANDIDATE_FLOOR_DIRTY));

  // Nothing was recorded meant it was re-planned every tick; the ledger entry is what
  // stops that.
  expect(h.ledger.recorded()).toEqual([DIRTY_FLOOR_SURFACE]);

  expect(summary.findingsPersisted).toBe(1);
  expect(summary.candidatesUnrenderable).toBe(0);
  expect(h.errors().filter((line) => line.includes(DIRTY_FLOOR_KIND))).toHaveLength(1);
});

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const DB_SRC = path.join(REPO_ROOT, "packages", "db", "src");

const FINDINGS_REPO = path.join(DB_SRC, "repositories", "findings.repo.ts");

const RECORDING_SUMMARIES_REPO = path.join(
  DB_SRC,
  "repositories",
  "recording-summaries.repo.ts",
);

const PLAN_SOURCE = path.join(REPO_ROOT, "worker", "src", "analysis", "plan.ts");

// `src/testing/` is the sanctioned home of the one helper that writes an unscanned row
// (ADD trade-off 6); `__tests__/finding-text-reach.test.ts` proves it is used only from tests.
const WRITE_SCAN_EXEMPT = `${path.sep}testing${path.sep}`;

const WRITE_VERB = /(?:\binsertOrFetch|\.insert|\.update|\.values)\s*\(/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function parenGroupAt(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return source.slice(openIndex + 1);
}

function writesFindingText(source: string): boolean {
  const stripped = stripComments(source);
  const verb = new RegExp(WRITE_VERB.source, "g");

  for (let match = verb.exec(stripped); match !== null; match = verb.exec(stripped)) {
    const open = stripped.indexOf("(", match.index);
    if (open === -1) continue;
    const group = parenGroupAt(stripped, open);
    if (/\bheadline\b/.test(group) || /\bcontext\b/.test(group)) return true;
  }

  return false;
}

function dbSourceFiles(): readonly string[] {
  return readdirSync(DB_SRC, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => path.join(DB_SRC, entry))
    .filter((file) => !file.includes(WRITE_SCAN_EXEMPT));
}

const PLANTED_WRITER = "await db.insert(findings).values({ headline: row.headline });";

const CLEAN_NEIGHBOUR_WRITER = "await db.insert(fixes).values({ specMarkdown: row.spec });";

test("a second write path to the findings table cannot bypass FindingsRepo.persist as the only route to headline and context", () => {
  const files = dbSourceFiles();
  expect(files.length).toBeGreaterThan(10);

  expect(writesFindingText(PLANTED_WRITER)).toBe(true);
  expect(writesFindingText(CLEAN_NEIGHBOUR_WRITER)).toBe(false);

  const writers = files
    .filter((file) => writesFindingText(readFileSync(file, "utf8")))
    .map((file) => path.relative(REPO_ROOT, file).split(path.sep).join("/"));

  // Two seams write scanned text now, and both must demand the brand. A new writer added
  // here without its ScannedText assertion below is the bypass this test exists to catch.
  expect(writers.toSorted()).toEqual([
    "packages/db/src/repositories/findings.repo.ts",
    "packages/db/src/repositories/recording-summaries.repo.ts",
  ]);

  for (const seam of [FINDINGS_REPO, RECORDING_SUMMARIES_REPO]) {
    const repo = stripComments(readFileSync(seam, "utf8"));
    expect(repo).toMatch(/headline:\s*ScannedText/);
    expect(repo).toMatch(/context:\s*readonly ScannedText\[\]/);
  }
});

const OWNER_GATE = "ADD Wave 1.1 (packages/core/src/delivery/finding-text.ts)";

type MirrorFindingText =
  | { readonly held: false; readonly headline: string; readonly context: readonly string[] }
  | { readonly held: true; readonly why: "residual_pii"; readonly kind: string }
  | { readonly held: true; readonly why: "unreadable" };

type MirrorReviewFindingText = (input: {
  readonly headline: string;
  readonly context: readonly string[];
}) => MirrorFindingText;

// The composition is the only injectable throw: everything reaching the persist seam has
// already been through `modelSummaryOutputSchema`, so it is a plain string by then.
const REFUSES_COMPOSITION = {
  toString(): string {
    throw new Error("o21-scan-input-refused-composition");
  },
} as unknown as string;

test("a scan that throws at the persist seam degrades to the floor, never persists the model text", async () => {
  const mirrorReviewFindingText = await loadUnderConstruction<MirrorReviewFindingText>({
    modulePath: underConstructionSpecifier("packages/core/src/delivery/finding-text.ts"),
    exportName: "reviewFindingText",
    ownedBy: OWNER_GATE,
  });

  expect(
    mirrorReviewFindingText({ headline: CLEAN_HEADLINE, context: [REFUSES_COMPOSITION] }),
  ).toEqual({
    held: true,
    why: "unreadable",
  });

  const plan = stripComments(readFileSync(PLAN_SOURCE, "utf8"));
  expect(plan).toContain("reviewFindingText(");
  expect(plan).toContain(".held");
  expect(plan).toContain("floor_model_text_rejected");

  // Both held arms leave by the same door, so the throw lands where a hit lands.
  expect(plan).not.toMatch(/\bwhy\s*[=!]==/);
  expect(plan).not.toContain(`"unreadable"`);
  expect(plan).not.toContain(`"residual_pii"`);

  const h = harness({ summariser: dirtySummariser() });
  await runAnalysisTick(h.deps);

  expect(h.findings.persistCalls().map((call) => call.summarySource)).toEqual([
    "floor_model_text_rejected",
  ]);
});

test("no log argument from any degrade or withhold path contains the planted offender", async () => {
  const h = harness({ summariser: dirtySummariser() });

  await runAnalysisTick(h.deps);

  const lines = h.logs();
  expect(lines.length).toBeGreaterThan(0);

  for (const line of lines) {
    expect(JSON.stringify(line)).not.toContain(PLANTED_CREDENTIAL);
  }

  const signature = signatureOf(CANDIDATE_A);
  expect(
    lines.filter((line) => line.includes(signature) && line.includes(PLANTED_CREDENTIAL_KIND)),
  ).toHaveLength(1);
});
