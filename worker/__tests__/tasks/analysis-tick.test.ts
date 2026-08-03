import {
  EVIDENCE_SHAPE_VERSION,
  GATE_REASON_MESSAGES,
  PROOF_PREDICATE_VERSION,
  SIGNATURE_TUPLE_VERSION,
  THRESHOLD_RULE_SET_VERSION,
  candidateFindingSchema,
  measuredCount,
} from "@growthmind/core";
import type { CandidateFinding, MeasuredCount, TraceEntry } from "@growthmind/core";
import { computeFindingSignature, signatureHex } from "@growthmind/db";
import type {
  AnalysisRunRecord,
  AnalysisRunsRepo,
  CloseRunInput,
  FindingRecord,
  FindingSignatureRecord,
  FindingsRepo,
  OpenRunResult,
  PersistFindingInput,
  RecordSignatureResult,
  SignatureLedgerService,
} from "@growthmind/db";
import type { SessionSummariser, SummariseInput } from "@growthmind/adapters";
import type { SummaryRenderResult, TenantContext } from "@growthmind/shared";
import { tenantContextSchema } from "@growthmind/shared";
import { expect, test } from "bun:test";

import type {
  AnalysisLane,
  AnalysisLaneDeps,
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
  AnalysisTickSummary,
} from "../../src/tasks/analysis-tick";
import { runAnalysisLane, runAnalysisTick } from "../../src/tasks/analysis-tick";

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

const OFFENDING_CONTEXT = "47 people gave up because the payment form is broken.";

function count(numerator: number, kept: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: WINDOW,
    basis: { totalInWindow: kept, kept, setAside: [] },
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
}

function findingKey(organizationId: string, projectId: string, signature: string): string {
  return `${organizationId}|${projectId}|${signature}`;
}

function createFakeFindings(): FakeFindings {
  const stored = new Map<string, FindingRecord>();
  const broken = new Set<string>();
  let nextId = 1;

  return {
    rows: () => [...stored.values()],
    rowFor: (signature) => stored.get(findingKey(ORG, PROJECT, signature)),
    breakOn: (signature) => broken.add(signature),
    repoFor: (ctx) => ({
       
      persist(input: PersistFindingInput): Promise<FindingRecord> {
        if (broken.has(input.signature)) {
          return Promise.reject(new Error("o11-findings-store-unavailable"));
        }
        const key = findingKey(ctx.organizationId, input.projectId, input.signature);
        const existing = stored.get(key);
        if (existing) return Promise.resolve(existing);

        const row = {
          ...input,
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
}

function notThisLane(name: string): () => never {
  return () => {
    throw new Error(`the analysis tick must never call ${name}`);
  };
}

function createFakeLedger(): FakeLedger {
  const recorded: string[] = [];
  return {
    recorded: () => [...recorded],
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
      consultSignature: notThisLane("consultSignature"),
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
}

function recordingLogger(sink: string[]): AnalysisLogger {
  return {
    info: (message: string) => sink.push(message),
    error: (message: string) => sink.push(message),
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

  return {
    findings,
    runs,
    ledger,
    summariser,
    logs: () => [...sink],
    deps: {
      lanes: laneSource(options.lanes ?? [lane()]),
       
      summariser:
        summariser === null ? null : { port: summariser.port, resolvedModelId: MODEL_ID },
      findingsFor: findings.repoFor,
      runsFor: runs.repoFor,
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
      logger: recordingLogger(sink),
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
  expect(first?.headline).toBe(CLEAN_HEADLINE);
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

  const closed = h.runs.rows().filter((row) => TERMINAL.includes(row.status));
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
    modelCallsAttempted: 0,
  });
   
  expect(held.runs.rows()).toHaveLength(1);
  expect(held.runs.rows()[0]?.status).toBe("running");
});
