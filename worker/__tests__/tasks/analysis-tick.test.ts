// The analysis lane's composition root, driven end to end (O-011, W1–W12).
//
// WAVE 0. `worker/src/tasks/analysis-tick.ts` does not exist yet, so this file
// is RED by construction — that is its job. What it pins is the CONTRACT the
// Wave 3 implementation must satisfy, and every shape it imports is imported
// from the module that will own it, never re-declared here: a look-alike
// interface in a test is a test that keeps agreeing with a module that no
// longer exists.
//
// WHY ALL TWELVE DRIVE `runAnalysisTick` AND NOTHING ELSE
// -------------------------------------------------------
// The degradation ladder (ADD AD-9) is not a property of the summariser, and it
// is not a property of the findings repository. It is a property of the ORDER
// the task calls them in — key check, then claim, then call, then re-parse,
// then guard, then persist. A suite that tested the summariser's `ok:false`
// arm and, separately, that the repository stores whatever `summarySource` it
// is handed, would be green against a task that never wires the two together:
// the D11 costume where a value is computed and then dropped on the floor.
// So there is exactly one entry point in this file, and the fakes sit at the
// PORTS.
//
// House rules honoured here:
//   - FIXTURE TIME IS A CONSTANT. `deps.now` is the only clock, and it returns
//     `TICK_AT`. Nothing below reads `Date.now()`.
//   - The fakes HOLD REAL STATE. The claim ledger counts against the cap and
//     refuses a repeat key; the findings store is keyed on the real unique
//     tuple. That is what makes W12 ("drive the same tick twice") a real
//     sequence rather than a script of expected calls.
//   - The counting summariser's call count is an ASSERTION, not a log. W2 and
//     W12 are only meaningful because of it.
//   - Every assertion can fail: no value is written by this file on both sides
//     of a wire, and the fixtures that must differ (W4 vs W5) differ in exactly
//     one input.
//   - No network, no real key, no sleep, no socket.
import {
  EVIDENCE_SHAPE_VERSION,
  GATE_REASON_MESSAGES,
  PROOF_PREDICATE_VERSION,
  THRESHOLD_RULE_SET_VERSION,
  candidateFindingSchema,
  measuredCount,
} from "@growthmind/core";
import type { CandidateFinding, MeasuredCount, TraceEntry } from "@growthmind/core";
import { signatureHex } from "@growthmind/db";
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
import { expect, test } from "bun:test";

// THE MODULE UNDER TEST. It does not exist in Wave 0; this import is the
// failure every test below reports until Wave 3 lands it.
import type {
  AnalysisCandidate,
  AnalysisLane,
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
} from "../../src/tasks/analysis-tick";
import { runAnalysisTick } from "../../src/tasks/analysis-tick";

// ---------------------------------------------------------------------------
// Frozen fixtures — all `o11`-prefixed, colliding with no other suite
// ---------------------------------------------------------------------------

/** The suite's ONLY instant. Every date below descends from it. */
const TICK_AT = new Date("2026-08-01T09:00:00.000Z");
const WINDOW = {
  start: new Date("2026-07-25T00:00:00.000Z"),
  end: new Date("2026-08-01T00:00:00.000Z"),
};

const ORG = "o11-org";
const ORG_NAME = "Acme";
const PROJECT = "o11-project";
const MODEL_ID = "o11-model-under-test";

/** Prose the SAC guard has no reason to refuse: no bare number, no denominator-
 * less count, no causal connective, no machine identifier. */
const CLEAN_HEADLINE = "The payment step is losing sessions";
const CLEAN_CONTEXT = "Sessions reached the payment step and left without finishing.";

/** A PLANTED SAC offender: a bare count with no denominator, plus a causal
 * connective asserting a cause the gate never established. Schema-VALID — that
 * is the whole point of W5. */
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

/**
 * A real candidate, PARSED through the shipped schema — never a hand-built
 * shape the lane could not actually produce. `surface` is the per-candidate
 * discriminator W7 reads its ordering off.
 */
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

/** `candidate_key` is SUPPLIED BY THE LANE (AD-13) — this sprint computes no
 * identity of its own, so the fixture hands one over rather than deriving it. */
function laneCandidate(key: string, surface: string): AnalysisCandidate {
  return { candidateKey: key, candidate: candidate(surface) };
}

const CANDIDATE_A = laneCandidate("o11-key-a", "/checkout/payment");
const CANDIDATE_B = laneCandidate("o11-key-b", "/checkout/review");
const CANDIDATE_C = laneCandidate("o11-key-c", "/signup/verify");

/**
 * W13's subject: a surface carrying a live password-reset token in a path
 * segment — the exact shape `packages/shared/src/sessions/url-path.ts` redacts
 * and `isNormalisedUrlPath` therefore answers `false` for.
 *
 * `CandidateFinding.surface` is only `z.string().min(1)`, so this parses through
 * the shipped schema like every other fixture here. That is the whole hazard: a
 * value nothing upstream refuses, reaching a third party and a permanent column.
 *
 * The token is a distinctive literal so W13 can assert it appears in NO log
 * line — the value is the secret, and a log is a third place it would live.
 */
const LEAKED_TOKEN = "a1b2c3d4e5f6a7b8c9d0";
const CANDIDATE_LEAKY = laneCandidate("o11-key-leaky", `/reset-password/${LEAKED_TOKEN}`);

/** The lane's candidate order is FIXED — cap exhaustion is only reproducible
 * because it is (ADD §7.5). */
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
  return { listDueLanes: () => Promise.resolve(lanes) };
}

// ---------------------------------------------------------------------------
// The counting summariser — the call count is an assertion
// ---------------------------------------------------------------------------

interface CountingSummariser {
  port: SessionSummariser;
  /** How many times the model was actually addressed. W2's whole subject. */
  calls: () => number;
  /** The ordered surfaces the model was asked about. W7's whole subject: an
   * order asserted explicitly, never inferred from a count. */
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

// ---------------------------------------------------------------------------
// In-memory findings store, keyed on the REAL unique tuple
// ---------------------------------------------------------------------------

interface FakeFindings {
  repoFor: (ctx: TenantContext) => FindingsRepo;
  rows: () => FindingRecord[];
  rowFor: (candidateKey: string) => FindingRecord | undefined;
  /** Makes `persist` throw for one candidate key — W11's mid-run fault. */
  breakOn: (candidateKey: string) => void;
}

function findingKey(organizationId: string, projectId: string, candidateKey: string): string {
  return `${organizationId}|${projectId}|${candidateKey}`;
}

function createFakeFindings(): FakeFindings {
  const stored = new Map<string, FindingRecord>();
  const broken = new Set<string>();
  let nextId = 1;

  return {
    rows: () => [...stored.values()],
    rowFor: (candidateKey) => stored.get(findingKey(ORG, PROJECT, candidateKey)),
    breakOn: (candidateKey) => broken.add(candidateKey),
    repoFor: (ctx) => ({
      // `INSERT … ON CONFLICT (organization_id, project_id, candidate_key) DO
      // NOTHING RETURNING *`, then a scoped read on conflict. Retry-safe BY
      // CONSTRUCTION — never check-then-write, which is what makes W12 a
      // property of the code rather than of the fixture ordering.
      persist(input: PersistFindingInput): Promise<FindingRecord> {
        if (broken.has(input.candidateKey)) {
          return Promise.reject(new Error("o11-findings-store-unavailable"));
        }
        const key = findingKey(ctx.organizationId, input.projectId, input.candidateKey);
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

      findByCandidateKey(projectId: string, candidateKey: string): Promise<FindingRecord | null> {
        return Promise.resolve(
          stored.get(findingKey(ctx.organizationId, projectId, candidateKey)) ?? null,
        );
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// In-memory runs repo + the atomic cap claim (AD-4)
// ---------------------------------------------------------------------------

interface FakeRuns {
  repoFor: (ctx: TenantContext) => AnalysisRunsRepo;
  rows: () => AnalysisRunRecord[];
  /** The claim ledger, in call order — W7 asserts this sequence explicitly. */
  claimAttempts: () => readonly string[];
  /** The keys that actually WON a claim, i.e. the cap consumed. */
  claimed: () => readonly string[];
}

function createFakeRuns(): FakeRuns {
  const runs = new Map<string, AnalysisRunRecord>();
  /** `(organization_id, project_id, candidate_key)` — the retry guard. */
  const claims = new Set<string>();
  const attempts: string[] = [];
  let nextRunId = 1;

  function projectClaimCount(organizationId: string, projectId: string): number {
    return [...claims].filter((key) => key.startsWith(`${organizationId}|${projectId}|`)).length;
  }

  return {
    rows: () => [...runs.values()],
    claimAttempts: () => [...attempts],
    claimed: () => [...claims].map((key) => key.split("|")[2] ?? ""),
    repoFor: (ctx) => ({
      open(input: { projectId: string; tickAt: Date }): Promise<OpenRunResult> {
        // The partial unique index on `(organization_id, project_id) WHERE
        // status = 'running'`: a second open while one is running returns the
        // OPEN ROW rather than throwing (D4).
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
          resolvedModelId: input.resolvedModelId,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
        } as unknown as AnalysisRunRecord;
        runs.set(closed.id, closed);
        return Promise.resolve(closed);
      },

      // ONE STATEMENT, NO PRIOR READ. The count predicate and the conflict
      // target are evaluated together, so two refusals are distinguishable
      // without a check-then-write window.
      claimModelCall(input: {
        projectId: string;
        runId: string;
        candidateKey: string;
        cap: number;
        at: Date;
      }) {
        attempts.push(input.candidateKey);
        const key = findingKey(ctx.organizationId, input.projectId, input.candidateKey);
        if (claims.has(key)) {
          return Promise.resolve({ claimed: false as const, reason: "already_claimed" as const });
        }
        if (projectClaimCount(ctx.organizationId, input.projectId) >= input.cap) {
          return Promise.resolve({ claimed: false as const, reason: "cap_exhausted" as const });
        }
        claims.add(key);
        return Promise.resolve({ claimed: true as const });
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// The ledger fake — analysis RECORDS, and nothing else (AD-1)
// ---------------------------------------------------------------------------

interface FakeLedger {
  serviceFor: (ctx: TenantContext) => SignatureLedgerService;
  recorded: () => readonly string[];
}

/** Every ledger entry point the analysis lane must NOT reach. Typed as a
 * throwing thunk so a call is a loud failure, not a silent `undefined`. */
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

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

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
      summariser: summariser === null ? null : summariser.port,
      findingsFor: findings.repoFor,
      runsFor: runs.repoFor,
      ledgerFor: ledger.serviceFor,
      cap: options.cap ?? 12,
      // THE ONLY CLOCK. A test that let the handler read the wall clock could
      // not assert a run instant at all.
      now: () => TICK_AT,
      logger: recordingLogger(sink),
    },
  };
}

/** The summary source persisted for one candidate — read back off the STORE,
 * never off a value this file handed the handler. */
function sourceFor(h: Harness, candidateKey: string): string | undefined {
  return h.findings.rowFor(candidateKey)?.summarySource;
}

/** Drives one lane with one summariser behaviour and returns the source that
 * landed. The shared body of W1/W4/W5/W6 — the four ladder rungs that differ in
 * EXACTLY ONE input, so a collapse between any two of them is attributable. */
async function sourceForBehaviour(behaviour: SummariserBehaviour): Promise<string | undefined> {
  const summariser = countingSummariser(behaviour);
  const h = harness({ summariser });
  await runAnalysisTick(h.deps);
  return sourceFor(h, CANDIDATE_A.candidateKey);
}

const TERMINAL: readonly string[] = ["completed", "failed"];

// ---------------------------------------------------------------------------
// W1–W6 — the degradation ladder, one rung per test (AD-9)
// ---------------------------------------------------------------------------

test("driving the analysis task with a working model persists a finding with summary_source model_rendered", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  const row = h.findings.rowFor(CANDIDATE_A.candidateKey);
  expect(row?.summarySource).toBe("model_rendered");
  // The model was actually addressed — a `model_rendered` row with zero calls
  // would be a claim about text nobody generated.
  expect(summariser.calls()).toBe(1);
  // Attribution travels with the finding (AD-5): the id came from the port's
  // result, not from a constant this file also asserts against the handler.
  expect(row?.resolvedModelId).toBe(MODEL_ID);
  // And the ledger recorded the identity, as the analysis lane owes it (AD-1).
  expect(h.ledger.recorded()).toEqual([CANDIDATE_A.candidate.surface]);
});

test("driving the analysis task with no key configured persists floor_no_key_configured and attempts zero model calls", async () => {
  // The counting fake is WIRED but `deps.summariser` is null: the composition
  // root SELECTS the no-key lane (AD-15), it never tries and fails. If the
  // handler ever reached for a port it was not given, this count would move.
  const unreachable = cleanSummariser();
  const h = harness({ summariser: null });

  await runAnalysisTick(h.deps);

  expect(sourceFor(h, CANDIDATE_A.candidateKey)).toBe("floor_no_key_configured");
  // ZERO CALLS, asserted on the counting fake — not merely "the source says
  // floor". A handler that called and swallowed the failure would still land a
  // floor row; only this number tells the two apart.
  expect(unreachable.calls()).toBe(0);
  // No key means no cap consumed either — the key check precedes the claim.
  expect(h.runs.claimed()).toEqual([]);
  // The finding itself is unchanged in kind: no call was attempted, so there is
  // no model to attribute (AD-5's `null iff no call attempted`).
  expect(h.findings.rowFor(CANDIDATE_A.candidateKey)?.resolvedModelId).toBeNull();
});

test("driving the analysis task past the cap persists floor_cap_exhausted for the candidate after the limit", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    summariser,
    cap: 2,
  });

  await runAnalysisTick(h.deps);

  // THE POST-CAP CANDIDATE IS STILL PERSISTED. A cap that dropped candidates
  // would make "we stopped early" indistinguishable from "there was nothing
  // more", which is the exact confusion SAC-10 exists to prevent.
  expect(h.findings.rows()).toHaveLength(3);
  expect(sourceFor(h, CANDIDATE_C.candidateKey)).toBe("floor_cap_exhausted");
  // The two below the cap are unaffected — the floor applies to the third only.
  expect(sourceFor(h, CANDIDATE_A.candidateKey)).toBe("model_rendered");
  expect(sourceFor(h, CANDIDATE_B.candidateKey)).toBe("model_rendered");
});

test("driving the analysis task with unparseable model output persists floor_model_output_invalid", async () => {
  // (a) the port's own `output_invalid` arm.
  expect(
    await sourceForBehaviour(() =>
      Promise.resolve(failed("output_invalid", "the answer could not be read")),
    ),
  ).toBe("floor_model_output_invalid");

  // (b) the pre-persistence RE-PARSE: an `ok:true` arm carrying text the output
  //     schema refuses (`headline` is `.min(1)`). Both mechanisms are the same
  //     rung, and the handler must reach it from either.
  expect(await sourceForBehaviour(() => Promise.resolve(ok("", CLEAN_CONTEXT)))).toBe(
    "floor_model_output_invalid",
  );
});

test("driving the analysis task with guard-rejected model text persists floor_model_text_rejected", async () => {
  // SCHEMA-VALID text carrying a planted SAC offender. The ONLY difference from
  // W4(b) is the string — same lane, same candidate, same cap, same fake.
  const rejected = await sourceForBehaviour(() =>
    Promise.resolve(ok(CLEAN_HEADLINE, OFFENDING_CONTEXT)),
  );
  expect(rejected).toBe("floor_model_text_rejected");

  // THE DISTINCTION THAT MUST NEVER COLLAPSE (`summary/types.ts:87-99`). "The
  // shape could not be read" and "the prose said something it may not assert"
  // are different debugging signals, and a handler that routed both through one
  // member would pass every assertion above this line.
  const invalid = await sourceForBehaviour(() =>
    Promise.resolve(failed("output_invalid", "the answer could not be read")),
  );
  expect(rejected).not.toBe(invalid);
  expect([rejected, invalid]).toEqual(["floor_model_text_rejected", "floor_model_output_invalid"]);

  // NON-VACUITY: the same fixture with clean prose reaches `model_rendered`, so
  // the rejection above is attributable to the offender and not to the harness.
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

  expect(sourceFor(h, CANDIDATE_A.candidateKey)).toBe("floor_model_call_failed");
  // A FAILED CALL STILL CONSUMES THE CAP (FR-M6, AD-9): the claim precedes the
  // call, so a project cannot buy unlimited retries by failing.
  expect(h.runs.claimed()).toEqual([CANDIDATE_A.candidateKey]);
});

// ---------------------------------------------------------------------------
// W7–W8 — the cap, its order, and how its exhaustion reads (SAC-10)
// ---------------------------------------------------------------------------

test("with cap N and N plus one eligible candidates exactly N model calls occur in deterministic order", async () => {
  const CAP = 2;
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    summariser,
    cap: CAP,
  });

  await runAnalysisTick(h.deps);

  // EXACTLY N calls.
  expect(summariser.calls()).toBe(CAP);
  // AND IN THE LANE'S ORDER, asserted explicitly rather than inferred from the
  // count: a handler that spent the cap on the last two candidates would
  // satisfy the number above and none of this.
  expect(summariser.surfaces()).toEqual([
    CANDIDATE_A.candidate.surface,
    CANDIDATE_B.candidate.surface,
  ]);
  // Every candidate was OFFERED to the cap, in order — the third was refused,
  // not skipped.
  expect(h.runs.claimAttempts()).toEqual([
    CANDIDATE_A.candidateKey,
    CANDIDATE_B.candidateKey,
    CANDIDATE_C.candidateKey,
  ]);
  expect(h.runs.claimed()).toEqual([CANDIDATE_A.candidateKey, CANDIDATE_B.candidateKey]);
});

test("cap exhaustion records stop_reason cap_exhausted and never presents as ran_to_completion", async () => {
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    cap: 2,
  });

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.stopReason).toBe("cap_exhausted");
  // "WE STOPPED EARLY" MUST NEVER READ AS "THERE WAS NOTHING MORE TO FIND".
  // This is SAC-10's exact subject: the second reading would tell a founder
  // their product is quieter than it is.
  expect(run?.stopReason).not.toBe("ran_to_completion");
  // The run still COMPLETED, and it still produced findings — a spent cap is
  // not a failure and not an empty answer.
  expect(run?.status).toBe("completed");
  expect(run?.outcome).toBe("produced_findings");
  expect(run?.outcome).not.toBe("no_candidates_passed_gate");
  // NON-VACUITY: the same lane under a cap wide enough for it reports the other
  // stop reason, so `cap_exhausted` above is a real judgement, not a constant.
  const roomy = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    cap: 12,
  });
  await runAnalysisTick(roomy.deps);
  expect(roomy.runs.rows()[0]?.stopReason).toBe("ran_to_completion");
});

// ---------------------------------------------------------------------------
// W9–W11 — every exit path is terminal (D8)
// ---------------------------------------------------------------------------

test("the happy path leaves the run row completed", async () => {
  const h = harness({ lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B] })] });

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).toBe("completed");
  expect(run?.finishedAt).toEqual(TICK_AT);
  expect(run?.failureReason).toBeNull();
  // The run's own attribution: two calls attempted, and the model addressed is
  // recorded (AD-5) — null here would mean "no call was attempted at all".
  expect(run?.modelCallsAttempted).toBe(2);
  expect(run?.resolvedModelId).toBe(MODEL_ID);
});

test("a thrown model error leaves the run row terminal and never running", async () => {
  // The port is CONTRACTED never to throw. A port somebody breaks anyway must
  // not become a run stuck `running` forever — the stuck-state class (D8).
  const summariser = countingSummariser(() => {
    throw new Error("o11-summariser-contract-violation");
  });
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).not.toBe("running");
  expect(TERMINAL).toContain(String(run?.status));
  expect(run?.finishedAt).not.toBeNull();
  // AND THE FINDING STILL LANDS, via the floor: a broken model is an absence of
  // written explanation, never an absence of the finding (SAC-6).
  const row = h.findings.rowFor(CANDIDATE_A.candidateKey);
  expect(row).toBeDefined();
  expect(String(row?.summarySource)).toStartWith("floor_");
  // The thrown text is OURS to log, never the customer's to read.
  expect(String(run?.failureReason ?? "")).not.toContain("o11-summariser-contract-violation");
});

test("a mid-run persistence failure leaves the run row terminal and corrupts no finding row", async () => {
  const h = harness({ lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })] });
  // Candidate k = 2: the store throws on B, after A has already landed.
  h.findings.breakOn(CANDIDATE_B.candidateKey);

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).toBe("failed");
  expect(run?.status).not.toBe("running");
  expect(run?.finishedAt).not.toBeNull();
  // A PLAIN-ENGLISH REASON, not the store's own error text: `failure_reason` is
  // what a founder reads when a check did not finish.
  const reason = String(run?.failureReason ?? "");
  expect(reason.length).toBeGreaterThan(0);
  expect(reason).not.toContain("o11-findings-store-unavailable");

  // CANDIDATES 1..k-1 SURVIVE, UNCORRUPTED. A half-run that rolled back the
  // work it had already done would lose a finding to a fault that had nothing
  // to do with it.
  const first = h.findings.rowFor(CANDIDATE_A.candidateKey);
  expect(first?.summarySource).toBe("model_rendered");
  expect(first?.headline).toBe(CLEAN_HEADLINE);
  expect(h.findings.rowFor(CANDIDATE_B.candidateKey)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// W12 — retry safety, by construction
// ---------------------------------------------------------------------------

test("a retried task run does not double-persist findings or double-consume the cap", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B] })],
    summariser,
    cap: 12,
  });

  // THE SAME TICK, DRIVEN TWICE over the same input — exactly what Graphile
  // Worker does to a job that failed after doing some of its work.
  await runAnalysisTick(h.deps);
  const callsAfterFirst = summariser.calls();
  await runAnalysisTick(h.deps);

  // ONE FINDING PER CANDIDATE.
  expect(h.findings.rows()).toHaveLength(2);
  expect(sourceFor(h, CANDIDATE_A.candidateKey)).toBe("model_rendered");
  expect(sourceFor(h, CANDIDATE_B.candidateKey)).toBe("model_rendered");

  // THE CAP CONSUMED ONCE. The counting fake is the assertion: a second pass
  // that re-called the model would be billed twice and would overwrite text a
  // customer may already have read.
  expect(callsAfterFirst).toBe(2);
  expect(summariser.calls()).toBe(2);
  expect(h.runs.claimed()).toEqual([CANDIDATE_A.candidateKey, CANDIDATE_B.candidateKey]);

  // AND NO RUN IS LEFT OPEN by the replay.
  for (const run of h.runs.rows()) {
    expect(run.status).not.toBe("running");
    expect(TERMINAL).toContain(String(run.status));
  }
});

// ---------------------------------------------------------------------------
// W13 — the surface gate stands BEFORE the ladder (security audit M-1)
// ---------------------------------------------------------------------------

test("a candidate whose surface is not normalised is refused before any model call or cap claim", async () => {
  const summariser = cleanSummariser();
  // THE REFUSED CANDIDATE GOES FIRST, so a gate that failed the lane instead of
  // isolating the candidate would cost the sibling its finding — which is what
  // the `model_rendered` assertion below would then catch.
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_LEAKY, CANDIDATE_A] })],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  // (1) THE VALUE NEVER LEFT THE PROCESS. `render` is the third-party egress,
  //     and the counting fake is the only thing that can tell "we refused it"
  //     from "we sent it and the answer was thrown away".
  expect(summariser.surfaces()).toEqual([CANDIDATE_A.candidate.surface]);
  expect(summariser.calls()).toBe(1);

  // (2) AND IT COST NO BUDGET. Not merely "won no claim" — it was never even
  //     OFFERED to the claim, which is the assertion that pins the gate ABOVE
  //     rung 2 rather than merely inside it. A candidate the model may not see
  //     must not consume a limit that exists to ration what the model sees.
  expect(h.runs.claimAttempts()).toEqual([CANDIDATE_A.candidateKey]);
  expect(h.runs.claimed()).toEqual([CANDIDATE_A.candidateKey]);

  // (3) NOTHING WAS WRITTEN DOWN. `persist` is the permanent-column egress, and
  //     it is refused for the same reason `render` is — a stored surface is not
  //     recallable, and the no-key lane persists a finding too.
  expect(h.findings.rowFor(CANDIDATE_LEAKY.candidateKey)).toBeUndefined();
  expect(h.findings.rows()).toHaveLength(1);
  // Nor was its identity filed: the ledger only ever sees surfaces that landed.
  expect(h.ledger.recorded()).toEqual([CANDIDATE_A.candidate.surface]);

  // (4) THE SURFACE IS IN NO LOG LINE. The offending value IS the secret, so
  //     the refusal names the candidate key and the cause and nothing else.
  //     Asserted over EVERY line this tick wrote, not just the refusal's own.
  for (const line of h.logs()) {
    expect(line).not.toContain(LEAKED_TOKEN);
    expect(line).not.toContain(CANDIDATE_LEAKY.candidate.surface);
  }
  // Non-vacuity for (4): the lane did log about this candidate — by key. A
  // handler that logged nothing at all would otherwise pass the loop above.
  expect(h.logs().some((line) => line.includes(CANDIDATE_LEAKY.candidateKey))).toBe(true);

  // (5) ONE CANDIDATE REFUSED MUST NOT COST THE PROJECT THE REST (D8). The
  //     sibling still reaches the top rung, and the run still completes.
  expect(sourceFor(h, CANDIDATE_A.candidateKey)).toBe("model_rendered");
  const [run] = h.runs.rows();
  expect(run?.status).toBe("completed");
  expect(run?.stopReason).toBe("ran_to_completion");

  // (6) COUNTED, NEVER SILENT — and counted APART from the floor's own refusal.
  //     `floor_model_text_rejected` and `candidatesUnrenderable` are answers
  //     about text; this is an answer about transmission, and a reader of the
  //     tick must not have to guess which happened.
  expect(summary.candidatesRefused).toBe(1);
  expect(summary.candidatesUnrenderable).toBe(0);
  expect(summary.findingsPersisted).toBe(1);
});

test("the surfaces every other test in this file drives are accepted by the gate", async () => {
  // W1–W12 assert the ladder's rungs. If the gate refused their fixtures, each
  // of them would go green for the WRONG REASON — no call made, no row written,
  // and an assertion on a source that never had to be chosen. This test is the
  // control that makes that failure loud instead of silent, driven through the
  // same real entry point rather than by calling the predicate directly.
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  expect(summary.candidatesRefused).toBe(0);
  // Every one of them reached the model and landed a finding — the gate is a
  // no-op on an ordinary page path.
  expect(summariser.surfaces()).toEqual([
    CANDIDATE_A.candidate.surface,
    CANDIDATE_B.candidate.surface,
    CANDIDATE_C.candidate.surface,
  ]);
  expect(h.findings.rows()).toHaveLength(3);
});
