// The analysis lane's composition root, driven end to end.
//
// Wave 0. `worker/src/tasks/analysis-tick.ts` does not exist yet, so this file is red
// by construction. That is its job. What it pins is the contract the Wave 3
// implementation must satisfy, and every shape it imports is imported from the module
// that will own it, never re-declared here: a look-alike interface in a test is a test
// that keeps agreeing with a module that no longer exists.
//
// Why all twelve drive `runAnalysisTick` and nothing else The degradation ladder is not
// a property of the summariser, and it is not a property of the findings repository. It
// is a property of the order the task calls them in. Key check, then claim, then call,
// then re-parse, then guard, then persist. A suite that tested the summariser's
// `ok:false` arm and, separately, that the repository stores whatever `summarySource`
// it is handed, would be green against a task that never wires the two together: the
// costume where a value is computed and then dropped on the floor. So there is exactly
// one entry point in this file, and the fakes sit at the ports.
//
// House rules honoured here:
// Fixture time is a constant. `deps.now` is the only clock, and it returns
//  `TICK_AT`. Nothing below reads `Date.now`.
// The fakes hold real state. The claim ledger counts against the cap and
//  refuses a repeat key; the findings store is keyed on the real unique
//  tuple. That is what makes W12 ("drive the same tick twice") a real
//  sequence rather than a script of expected calls.
// The counting summariser's call count is an assertion, not a log. and
//  W12 are only meaningful because of it.
// Every assertion can fail: no value is written by this file on both sides
//  of a wire, and the fixtures that must differ differ in exactly
//  one input.
// No network, no real key, no sleep, no socket.
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

// The module under test. It does not exist in Wave 0; this import is the failure every
// test below reports until Wave 3 lands it.
import type {
  AnalysisLane,
  AnalysisLaneDeps,
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
  AnalysisTickSummary,
} from "../../src/tasks/analysis-tick";
import { runAnalysisLane, runAnalysisTick } from "../../src/tasks/analysis-tick";

// Frozen fixtures, all `o11`-prefixed, colliding with no other suite

/** The suite's only instant. Every date below descends from it. */
const TICK_AT = new Date("2026-08-01T09:00:00.000Z");
const WINDOW = {
  start: new Date("2026-07-25T00:00:00.000Z"),
  end: new Date("2026-08-01T00:00:00.000Z"),
};

const ORG = "o11-org";
const ORG_NAME = "Acme";
const PROJECT = "o11-project";
const MODEL_ID = "o11-model-under-test";

/**
 * The organisation-wide ceiling, set so high that no case in this file can ever reach
 * it. Every cap case here is about the per-project limit, and a second ceiling that
 * could also refuse would make "the project cap refused it" unattributable. A green
 * test for the wrong reason. The organisation ceiling's own behaviour is proven against
 * real SQL, where it lives, in
 * `packages/db/__tests__/repositories/analysis-runs.repo.test.ts`.
 */
const ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE = 10_000;

/** Prose the sac guard has no reason to refuse: no bare number, no denominator-less
 * count, no causal connective, no machine identifier. */
const CLEAN_HEADLINE = "The payment step is losing sessions";
const CLEAN_CONTEXT = "Sessions reached the payment step and left without finishing.";

/** A planted sac offender: a bare count with no denominator, plus a causal connective
 * asserting a cause the gate never established. Schema-valid, that is the whole point
 * of W5. */
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
 * A real candidate, parsed through the shipped schema, never a hand-built shape the
 * lane could not actually produce. `surface` is the per-candidate discriminator W7
 * reads its ordering off.
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

/**
 * The signature the walker will derive for this candidate, computed here through the
 * same single producer the walker calls.
 *
 * This is not a value the test hands the handler and reads back. The lane port carries
 * no key at all, so the walker derives its own and every lookup below only finds a row
 * if the walker's derivation agrees with this one. A walker that keyed on an ordinal,
 * on the tick instant, or on any second hashing of its own would miss every row and
 * fail every assertion that uses this.
 *
 * It is also the property in fixture form: the inputs are the candidate's content, so
 * nothing about which tick ran or where the candidate sat in the lane can change the
 * answer.
 */
function signatureIn(projectId: string, subject: CandidateFinding): string {
  return computeFindingSignature({
    projectId,
    surface: subject.surface,
    symptomClass: subject.finalClass,
    evidenceShape: subject.evidenceShape,
  });
}

/** The same value for this file's own project. The form every test below the ladder
 * reads. `projectId` is a real input to the identity, not a constant, so it is named
 * once here rather than assumed at each call site. */
function signatureOf(subject: CandidateFinding): string {
  return signatureIn(PROJECT, subject);
}

const CANDIDATE_A = candidate("/checkout/payment");
const CANDIDATE_B = candidate("/checkout/review");
const CANDIDATE_C = candidate("/signup/verify");

/**
 * W13's subject: a surface carrying a live password-reset token in a path segment. The
 * exact shape `packages/shared/src/sessions/url-path.ts` redacts and
 * `isNormalisedUrlPath` therefore answers `false` for.
 *
 * `CandidateFinding.surface` is only `z.string.min`, so this parses through the
 * shipped schema like every other fixture here. That is the whole hazard: a value
 * nothing upstream refuses, reaching a third party and a permanent column.
 *
 * The token is a distinctive literal so W13 can assert it appears in NO log line. The
 * value is the secret, and a log is a third place it would live.
 */
const LEAKED_TOKEN = "a1b2c3d4e5f6a7b8c9d0";
const CANDIDATE_LEAKY = candidate(`/reset-password/${LEAKED_TOKEN}`);

/**
 * W16's subject: a candidate the deterministic floor cannot write up, while the surface
 * gate accepts it without complaint. The two refusals are different facts and the run
 * row keeps them in different columns; this fixture is what makes that separation
 * testable rather than asserted.
 *
 * `funnel_dropoff` declares two count roles (`core/src/summary/count-roles.ts`), so a
 * candidate carrying one makes `resolveCounts` refuse (it will not mislabel a number)
 * and `renderFloorSummary` throws. `candidateFindingSchema` allows it (`counts` is only
 * `.min`), which is precisely why the floor has to refuse it: nothing upstream does.
 */
function unrenderableCandidate(surface: string): CandidateFinding {
  return candidateFindingSchema.parse({ ...candidate(surface), counts: [count(28, 28)] });
}

/** Two of them, so W16's two columns hold different numbers and a `close` that wrote
 * one into both (or swapped them) cannot pass. */
const CANDIDATE_UNRENDERABLE_A = unrenderableCandidate("/checkout/confirm");
const CANDIDATE_UNRENDERABLE_B = unrenderableCandidate("/checkout/thanks");

/** The lane's candidate order is fixed. Cap exhaustion is only reproducible because it
 * is. */
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
    // O-008 AD-10. Implemented over the SAME list rather than stubbed to
    // `null`: a fake whose second method could never return a lane would make
    // every future row driving it vacuously green. Nothing in THIS file calls
    // it — the tick reaches lanes only through `listDueLanes` — so its presence
    // here is the port's shape, and its behaviour is proven against a real
    // database where it lives, in `analysis-lane-source.for-project.test.ts`.
    laneForProject: (projectId: string) =>
      Promise.resolve(lanes.find((row) => row.projectId === projectId) ?? null),
  };
}

// The counting summariser, the call count is an assertion

interface CountingSummariser {
  port: SessionSummariser;
  /** How many times the model was actually addressed. the whole subject. */
  calls: () => number;
  /** The ordered surfaces the model was asked about. W7's whole subject: an order
   * asserted explicitly, never inferred from a count. */
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

// In-memory findings store, keyed on the real unique tuple

interface FakeFindings {
  repoFor: (ctx: TenantContext) => FindingsRepo;
  rows: () => FindingRecord[];
  rowFor: (signature: string) => FindingRecord | undefined;
  /** Makes `persist` throw for one signature. W11's mid-run fault. */
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
      // `INSERT … ON CONFLICT (organization_id, project_id, signature) DO NOTHING
      // RETURNING *`, then a scoped read on conflict. Retry-safe by construction, never
      // check-then-write, which is what makes W12 a property of the code rather than of
      // the fixture ordering.
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

// In-memory runs repo + the atomic cap claim

interface FakeRuns {
  repoFor: (ctx: TenantContext) => AnalysisRunsRepo;
  rows: () => AnalysisRunRecord[];
  /** The claim ledger, in call order. W7 asserts this sequence explicitly. Signatures,
   * because that is what the claim is now keyed on. */
  claimAttempts: () => readonly string[];
  /** The signatures that actually won a claim, i.e. the cap consumed. */
  claimed: () => readonly string[];
}

function createFakeRuns(): FakeRuns {
  const runs = new Map<string, AnalysisRunRecord>();
  /** `(organization_id, project_id, signature)`, the retry guard. */
  const claims = new Set<string>();
  const attempts: string[] = [];
  let nextRunId = 1;

  function projectClaimCount(organizationId: string, projectId: string): number {
    return [...claims].filter((key) => key.startsWith(`${organizationId}|${projectId}|`)).length;
  }

  /** The organisation-wide ceiling's count: every project of this org summed, and no
   * other org's rows. The real statement is a second `AND` conjunct over
   * `analysis_model_calls` filtered on `organization_id` alone. */
  function organizationClaimCount(organizationId: string): number {
    return [...claims].filter((key) => key.startsWith(`${organizationId}|`)).length;
  }

  return {
    rows: () => [...runs.values()],
    claimAttempts: () => [...attempts],
    claimed: () => [...claims].map((key) => key.split("|")[2] ?? ""),
    repoFor: (ctx) => ({
      open(input: { projectId: string; tickAt: Date }): Promise<OpenRunResult> {
        // The partial unique index on `(organization_id, project_id) WHERE status =
        // 'running'`: a second open while one is running returns the open row rather
        // than throwing.
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
          // The two counts the run row carries for candidates that produced no finding.
          // Zero on an open run (nothing has been walked yet) and written by `close`
          // from the tick's own tally.
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
          // Taken from the close input, so an assertion on these reads what the handler
          // actually wrote to the run row rather than a count this file put there. A
          // tally that never reached `close` shows up as the seeded zero above.
          candidatesUnrenderable: input.candidatesUnrenderable,
          candidatesRefused: input.candidatesRefused,
          resolvedModelId: input.resolvedModelId,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
        } as unknown as AnalysisRunRecord;
        runs.set(closed.id, closed);
        return Promise.resolve(closed);
      },

      // One statement, no prior read. The count predicate and the conflict target are
      // evaluated together, so two refusals are distinguishable without a
      // check-then-write window.
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
        // Two ceilings, one answer. Either one being spent refuses the claim as
        // `cap_exhausted`. The real statement carries both as `AND` conjuncts and
        // reports no difference between them, and neither does this fake.
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

// The ledger fake, analysis records, and nothing else

interface FakeLedger {
  serviceFor: (ctx: TenantContext) => SignatureLedgerService;
  recorded: () => readonly string[];
}

/** Every ledger entry point the analysis lane must not reach. Typed as a throwing thunk
 * so a call is a loud failure, not a silent `undefined`. */
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

// The harness

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
      // The port and the model ID it addresses, paired as the composition root pairs
      // them (`ConfiguredSummariser`). `MODEL_ID` is the same constant the
      // `ok`/`failed` results carry, because in production it is the same resolved id
      // that goes to the provider and to the port, which is what makes attribution true
      // on the path where a throw leaves no result to read an id off.
      summariser:
        summariser === null ? null : { port: summariser.port, resolvedModelId: MODEL_ID },
      findingsFor: findings.repoFor,
      runsFor: runs.repoFor,
      ledgerFor: ledger.serviceFor,
      projectCap: options.cap === undefined ? 12 : options.cap,
      // Wide on purpose, and not a copy of the project ceiling. Every case in this file
      // exercises the per-project limit, so the organisation-wide one is set high
      // enough never to be the thing that refuses. A shared value would make "the
      // project cap refused it" unattributable. The organisation ceiling's own
      // behaviour is proven where it lives, in
      // `packages/db/__tests__/repositories/analysis-runs.repo.test.ts`.
      organizationCap: ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      // The only clock. A test that let the handler read the wall clock could not
      // assert a run instant at all.
      now: () => TICK_AT,
      logger: recordingLogger(sink),
    },
  };
}

/** The summary source persisted for one candidate. Read back off the store, never off a
 * value this file handed the handler. The lookup goes through `signatureOf`, so it only
 * finds a row when the walker's own derivation agrees with the one producer. */
function sourceFor(h: Harness, subject: CandidateFinding): string | undefined {
  return h.findings.rowFor(signatureOf(subject))?.summarySource;
}

/** Drives one lane with one summariser behaviour and returns the source that landed.
 * The shared body of //W5/W6. The four ladder rungs that differ in exactly one input,
 * so a collapse between any two of them is attributable. */
async function sourceForBehaviour(behaviour: SummariserBehaviour): Promise<string | undefined> {
  const summariser = countingSummariser(behaviour);
  const h = harness({ summariser });
  await runAnalysisTick(h.deps);
  return sourceFor(h, CANDIDATE_A);
}

const TERMINAL: readonly string[] = ["completed", "failed"];

// –W6, the degradation ladder, one rung per test

test("driving the analysis task with a working model persists a finding with summary_source model_rendered", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  const row = h.findings.rowFor(signatureOf(CANDIDATE_A));
  expect(row?.summarySource).toBe("model_rendered");
  // The model was actually addressed. A `model_rendered` row with zero calls would be a
  // claim about text nobody generated.
  expect(summariser.calls()).toBe(1);
  // Attribution travels with the finding: the id came from the port's result, not from
  // a constant this file also asserts against the handler.
  expect(row?.resolvedModelId).toBe(MODEL_ID);
  // And the ledger recorded the identity, as the analysis lane owes it.
  expect(h.ledger.recorded()).toEqual([CANDIDATE_A.surface]);
});

test("driving the analysis task with no key configured persists floor_no_key_configured and attempts zero model calls", async () => {
  // The counting fake is wired but `deps.summariser` is null: the composition root
  // selects the no-key lane, it never tries and fails. If the handler ever reached for
  // a port it was not given, this count would move.
  const unreachable = cleanSummariser();
  const h = harness({ summariser: null });

  await runAnalysisTick(h.deps);

  expect(sourceFor(h, CANDIDATE_A)).toBe("floor_no_key_configured");
  // Zero calls, asserted on the counting fake, not merely "the source says floor". A
  // handler that called and swallowed the failure would still land a floor row; only
  // this number tells the two apart.
  expect(unreachable.calls()).toBe(0);
  // No key means no cap consumed either. The key check precedes the claim.
  expect(h.runs.claimed()).toEqual([]);
  // The finding itself is unchanged in kind: no call was attempted, so there is no
  // model to attribute (the `null iff no call attempted`).
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

  // The POST-CAP candidate is still persisted. A cap that dropped candidates would make
  // "we stopped early" indistinguishable from "there was nothing more", which is the
  // exact confusion SAC-10 exists to prevent.
  expect(h.findings.rows()).toHaveLength(3);
  expect(sourceFor(h, CANDIDATE_C)).toBe("floor_cap_exhausted");
  // The two below the cap are unaffected. The floor applies to the third only.
  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  expect(sourceFor(h, CANDIDATE_B)).toBe("model_rendered");
});

test("driving the analysis task with unparseable model output persists floor_model_output_invalid", async () => {
  //  the port's own `output_invalid` arm.
  expect(
    await sourceForBehaviour(() =>
      Promise.resolve(failed("output_invalid", "the answer could not be read")),
    ),
  ).toBe("floor_model_output_invalid");

  //  the pre-persistence re-parse: an `ok:true` arm carrying text the output
  //  schema refuses (`headline` is `.min`). Both mechanisms are the same
  //  rung, and the handler must reach it from either.
  expect(await sourceForBehaviour(() => Promise.resolve(ok("", CLEAN_CONTEXT)))).toBe(
    "floor_model_output_invalid",
  );
});

test("driving the analysis task with guard-rejected model text persists floor_model_text_rejected", async () => {
  // Schema-valid text carrying a planted sac offender. The only difference from is
  // the string. Same lane, same candidate, same cap, same fake.
  const rejected = await sourceForBehaviour(() =>
    Promise.resolve(ok(CLEAN_HEADLINE, OFFENDING_CONTEXT)),
  );
  expect(rejected).toBe("floor_model_text_rejected");

  // The distinction that must never collapse (`summary/types.ts:87-99`). "The shape
  // could not be read" and "the prose said something it may not assert" are different
  // debugging signals, and a handler that routed both through one member would pass
  // every assertion above this line.
  const invalid = await sourceForBehaviour(() =>
    Promise.resolve(failed("output_invalid", "the answer could not be read")),
  );
  expect(rejected).not.toBe(invalid);
  expect([rejected, invalid]).toEqual(["floor_model_text_rejected", "floor_model_output_invalid"]);

  // Non-vacuity: the same fixture with clean prose reaches `model_rendered`, so the
  // rejection above is attributable to the offender and not to the harness.
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
  // A failed call still consumes the CAP: the claim precedes the call, so a project
  // cannot buy unlimited retries by failing.
  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A)]);
});

// W7–W8, the cap, its order, and how its exhaustion reads (SAC-10)

test("with cap N and N plus one eligible candidates exactly N model calls occur in deterministic order", async () => {
  const CAP = 2;
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    summariser,
    cap: CAP,
  });

  await runAnalysisTick(h.deps);

  // Exactly n calls.
  expect(summariser.calls()).toBe(CAP);
  // And in the lane's order, asserted explicitly rather than inferred from the count: a
  // handler that spent the cap on the last two candidates would satisfy the number
  // above and none of this.
  expect(summariser.surfaces()).toEqual([
    CANDIDATE_A.surface,
    CANDIDATE_B.surface,
  ]);
  // Every candidate was offered to the cap, in order. The third was refused, not
  // skipped.
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
  // "we stopped early" must never read as "there was nothing more to find". This is
  // SAC-10's exact subject: the second reading would tell a founder their product is
  // quieter than it is.
  expect(run?.stopReason).not.toBe("ran_to_completion");
  // The run still completed, and it still produced findings. A spent cap is not a
  // failure and not an empty answer.
  expect(run?.status).toBe("completed");
  expect(run?.outcome).toBe("produced_findings");
  expect(run?.outcome).not.toBe("no_candidates_passed_gate");
  // Non-vacuity: the same lane under a cap wide enough for it reports the other stop
  // reason, so `cap_exhausted` above is a real judgement, not a constant.
  const roomy = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    cap: 12,
  });
  await runAnalysisTick(roomy.deps);
  expect(roomy.runs.rows()[0]?.stopReason).toBe("ran_to_completion");
});

// W9–W11, every exit path is terminal

test("the happy path leaves the run row completed", async () => {
  const h = harness({ lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B] })] });

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).toBe("completed");
  expect(run?.finishedAt).toEqual(TICK_AT);
  expect(run?.failureReason).toBeNull();
  // The run's own attribution: two calls attempted, and the model addressed is
  // recorded. Null here would mean "no call was attempted at all".
  expect(run?.modelCallsAttempted).toBe(2);
  expect(run?.resolvedModelId).toBe(MODEL_ID);
});

test("a thrown model error leaves the run row terminal and never running", async () => {
  // The port is contracted never to throw. A port somebody breaks anyway must not
  // become a run stuck `running` forever. The stuck-state class.
  const summariser = countingSummariser(() => {
    throw new Error("o11-summariser-contract-violation");
  });
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).not.toBe("running");
  expect(TERMINAL).toContain(String(run?.status));
  expect(run?.finishedAt).not.toBeNull();
  // And the finding still lands, via the floor: a broken model is an absence of written
  // explanation, never an absence of the finding (SAC-6).
  const row = h.findings.rowFor(signatureOf(CANDIDATE_A));
  expect(row).toBeDefined();
  expect(String(row?.summarySource)).toStartWith("floor_");
  // The thrown text is ours to log, never the customer's to read.
  expect(String(run?.failureReason ?? "")).not.toContain("o11-summariser-contract-violation");
});

test("a mid-run persistence failure leaves the run row terminal and corrupts no finding row", async () => {
  const h = harness({ lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })] });
  // Candidate k = 2: the store throws on B, after A has already landed.
  h.findings.breakOn(signatureOf(CANDIDATE_B));

  await runAnalysisTick(h.deps);

  const [run] = h.runs.rows();
  expect(run?.status).toBe("failed");
  expect(run?.status).not.toBe("running");
  expect(run?.finishedAt).not.toBeNull();
  // A plain-english reason, not the store's own error text: `failure_reason` is what a
  // founder reads when a check did not finish.
  const reason = String(run?.failureReason ?? "");
  expect(reason.length).toBeGreaterThan(0);
  expect(reason).not.toContain("o11-findings-store-unavailable");

  // Candidates 1.k-1 survive, uncorrupted. A half-run that rolled back the work it had
  // already done would lose a finding to a fault that had nothing to do with it.
  const first = h.findings.rowFor(signatureOf(CANDIDATE_A));
  expect(first?.summarySource).toBe("model_rendered");
  expect(first?.headline).toBe(CLEAN_HEADLINE);
  expect(h.findings.rowFor(signatureOf(CANDIDATE_B))).toBeUndefined();
});

// W12, retry safety, by construction

test("a retried task run does not double-persist findings or double-consume the cap", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B] })],
    summariser,
    cap: 12,
  });

  // The same tick, driven twice over the same input. Exactly what Graphile Worker does
  // to a job that failed after doing some of its work.
  await runAnalysisTick(h.deps);
  const callsAfterFirst = summariser.calls();
  await runAnalysisTick(h.deps);

  // One finding per candidate.
  expect(h.findings.rows()).toHaveLength(2);
  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  expect(sourceFor(h, CANDIDATE_B)).toBe("model_rendered");

  // The CAP consumed once. The counting fake is the assertion: a second pass that
  // re-called the model would be billed twice and would overwrite text a customer may
  // already have read.
  expect(callsAfterFirst).toBe(2);
  expect(summariser.calls()).toBe(2);
  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A), signatureOf(CANDIDATE_B)]);

  // And no run is left open by the replay.
  for (const run of h.runs.rows()) {
    expect(run.status).not.toBe("running");
    expect(TERMINAL).toContain(String(run.status));
  }
});

// W13, the surface gate stands before the ladder (security audit)

test("a candidate whose surface is not normalised is refused before any model call or cap claim", async () => {
  const summariser = cleanSummariser();
  // The refused candidate goes first, so a gate that failed the lane instead of
  // isolating the candidate would cost the sibling its finding, which is what the
  // `model_rendered` assertion below would then catch.
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_LEAKY, CANDIDATE_A] })],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  //  the value never left the process. `render` is the third-party egress,
  //  and the counting fake is the only thing that can tell "we refused it"
  //  from "we sent it and the answer was thrown away".
  expect(summariser.surfaces()).toEqual([CANDIDATE_A.surface]);
  expect(summariser.calls()).toBe(1);

  //  and it cost no budget. Not merely "won no claim". It was never even
  //  Offered to the claim, which is the assertion that pins the gate above
  //  rung 2 rather than merely inside it. A candidate the model may not see
  //  must not consume a limit that exists to ration what the model sees.
  expect(h.runs.claimAttempts()).toEqual([signatureOf(CANDIDATE_A)]);
  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A)]);

  //  nothing was written down. `persist` is the permanent-column egress, and
  //  it is refused for the same reason `render` is — a stored surface is not
  //  recallable, and the no-key lane persists a finding too.
  //
  //  It is asserted by surface and not by signature, because this candidate
  //  Cannot have one: hashing an un-normalised surface into a permanent
  //  identity is a third egress of the same kind, and
  //  `computeFindingSignature` refuses it. That refusal is stated first, so
  //  the shape of the assertions below reads as a consequence rather than as
  //  an inconsistency — and so a walker that derived an identity here anyway
  //  would fail a named test rather than quietly succeed.
  expect(() => signatureOf(CANDIDATE_LEAKY)).toThrow();
  expect(h.findings.rows().some((row) => row.surface === CANDIDATE_LEAKY.surface)).toBe(false);
  expect(h.findings.rows()).toHaveLength(1);
  // Nor was its identity filed: the ledger only ever sees surfaces that landed.
  expect(h.ledger.recorded()).toEqual([CANDIDATE_A.surface]);

  //  the surface is in no log line. The offending value IS the secret, so
  //  the refusal names the candidate's position and the cause and nothing
  //  else — it cannot name a signature either, for the reason in.
  //  Asserted over every line this tick wrote, not just the refusal's own.
  for (const line of h.logs()) {
    expect(line).not.toContain(LEAKED_TOKEN);
    expect(line).not.toContain(CANDIDATE_LEAKY.surface);
  }
  // Non-vacuity for: the lane did log about this candidate. Naming the project and
  // the position it sat at in the walk. A handler that logged nothing at all would
  // otherwise pass the loop above.
  expect(
    h.logs().some(
      (line) =>
        line.includes(PROJECT) && line.includes("not in the form this product stores"),
    ),
  ).toBe(true);

  //  one candidate refused must not cost the PROJECT the REST. The
  //  sibling still reaches the top rung, and the run still completes.
  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  const [run] = h.runs.rows();
  expect(run?.status).toBe("completed");
  expect(run?.stopReason).toBe("ran_to_completion");

  //  counted, never silent, and counted apart from the floor's own refusal.
  //  `floor_model_text_rejected` and `candidatesUnrenderable` are answers
  //  about text; this is an answer about transmission, and a reader of the
  //  tick must not have to guess which happened.
  expect(summary.candidatesRefused).toBe(1);
  expect(summary.candidatesUnrenderable).toBe(0);
  expect(summary.findingsPersisted).toBe(1);
});

test("the surfaces every other test in this file drives are accepted by the gate", async () => {
  // –W12 assert the ladder's rungs. If the gate refused their fixtures, each of them
  // would go green for the wrong reason. No call made, no row written, and an assertion
  // on a source that never had to be chosen. This test is the control that makes that
  // failure loud instead of silent, driven through the same real entry point rather
  // than by calling the predicate directly.
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C] })],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  expect(summary.candidatesRefused).toBe(0);
  // Every one of them reached the model and landed a finding. The gate is a no-op on an
  // ordinary page path.
  expect(summariser.surfaces()).toEqual([
    CANDIDATE_A.surface,
    CANDIDATE_B.surface,
    CANDIDATE_C.surface,
  ]);
  expect(h.findings.rows()).toHaveLength(3);
});

// W14, the one path that must not write a terminal state

/**
 * How long before the tick the incumbent started. Derived from `TICK_AT` like every
 * other instant here, and deliberately well inside the run lease
 * (`ANALYSIS_RUN_LEASE_MS`, 45 minutes) so the incumbent is unambiguously live: the
 * fixture's subject is "another worker is holding this project right now", never "a run
 * old enough that the real repository would reclaim it". It is also distinct from
 * `TICK_AT`, which is what lets `startedAt` below prove the row read back is the
 * incumbent's and not a fresh one this tick minted.
 */
const INCUMBENT_STARTED_AT = new Date(TICK_AT.getTime() - 5 * 60 * 1000);

/** The other worker, in the same org. Parsed through the same context schema the
 * handler builds its own with. There is one accepted context shape, and a fixture that
 * skipped it would be seeding a row production could not. */
const OTHER_WORKER: TenantContext = tenantContextSchema.parse({
  userId: "system:o11-other-analysis-tick",
  organizationId: ORG,
  organizationName: ORG_NAME,
  role: "system",
});

test("a project another run already holds is left untouched, terminal write included", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });

  // Another worker got there first. Seeded through the repository's own open, so the
  // row is exactly the one the partial unique index on `(organization_id, project_id)
  // WHERE status = 'running'` will refuse ours against. Nothing is hand-built.
  const seeded = await h.runs.repoFor(OTHER_WORKER).open({
    projectId: PROJECT,
    tickAt: INCUMBENT_STARTED_AT,
  });
  expect(seeded.opened).toBe(true);
  const incumbent = seeded.run;

  const summary = await runAnalysisTick(h.deps);

  // The subject of this test: the incumbent row is exactly as its owner left it. This
  // is the only path in the lane that skips the terminal write, and the reason is that
  // the write would stamp our outcome onto a run somebody else is still working, so the
  // assertion is on the row's own fields, not on the absence of other effects.
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

  // No candidate was processed. A count on the counting fake, never an absence inferred
  // from something else.
  expect(summariser.calls()).toBe(0);
  // And no budget was touched. Not merely "won no claim": the candidate was never
  // offered to the claim, which is what keeps the cap's count subquery resting on a
  // single writer per project.
  expect(h.runs.claimAttempts()).toEqual([]);
  expect(h.runs.claimed()).toEqual([]);
  // Nothing written down, and no identity filed.
  expect(h.findings.rows()).toEqual([]);
  expect(h.ledger.recorded()).toEqual([]);

  // Not a failure, the single-writer guarantee working, counted as its own thing. This
  // is also the control that rules out the vacuous reading of every zero above: the
  // lane was considered, and it was skipped for this reason.
  expect(summary.lanesConsidered).toBe(1);
  expect(summary.lanesAlreadyRunning).toBe(1);
  expect(summary.lanesRun).toBe(0);
  expect(summary.lanesFailed).toBe(0);
  expect(summary.lanesErrored).toBe(0);

  // Non-vacuity: the identical lane with no incumbent does all of it, one call, one
  // claim, one finding, one closed run. So every zero above is the incumbent's doing
  // and not a fixture that could never have produced them.
  const unheld = cleanSummariser();
  const free = harness({ summariser: unheld });
  await runAnalysisTick(free.deps);
  expect(unheld.calls()).toBe(1);
  expect(free.runs.claimed()).toEqual([signatureOf(CANDIDATE_A)]);
  expect(sourceFor(free, CANDIDATE_A)).toBe("model_rendered");
  expect(free.runs.rows()[0]?.status).toBe("completed");
});

// W15, the two zeros never collapse (SAC-10's sibling, one level up)

/** Sessions were looked at; none of them produced anything solid enough. */
const QUIET_PROJECT = "o11-project-quiet";
/** There was nothing to look at yet. */
const UNVISITED_PROJECT = "o11-project-unvisited";

test("a run that found nothing records which nothing it found, and the two zeros never collapse", async () => {
  const summariser = cleanSummariser();
  // Two zero-candidate lanes differing in exactly one input: `sessionsConsidered`. Same
  // org, same everything else, so a handler that collapsed the two could not be excused
  // by any other difference between the fixtures.
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

  // "we looked and your product was quiet" and "we have not looked yet" are different
  // facts about a customer's product. Asserted as a pair, so a future collapse onto
  // either member fails here loudly rather than silently telling a founder their
  // product is quieter than it is.
  expect([quiet, unvisited]).toEqual(["no_candidates_passed_gate", "no_sessions_to_analyse"]);
  expect(quiet).not.toBe(unvisited);
  // And neither is the third member: a zero-candidate run has not produced findings,
  // whichever zero it is.
  expect(quiet).not.toBe("produced_findings");
  expect(unvisited).not.toBe("produced_findings");

  // Both still close TERMINAL. A run left `running` behind the partial unique index
  // jams its project's lane forever, and "there was nothing to do" is not an exemption
  // from the terminal write. It is the case most likely to look like one.
  for (const projectId of [QUIET_PROJECT, UNVISITED_PROJECT]) {
    const run = runFor(projectId);
    expect(run?.status).toBe("completed");
    expect(run?.status).not.toBe("running");
    expect(run?.finishedAt).toEqual(TICK_AT);
    expect(run?.stopReason).toBe("ran_to_completion");
    expect(run?.failureReason).toBeNull();
  }

  // Nothing was written and no model was addressed for either. An empty lane costs
  // nothing. `lanesRun` is the control: both lanes really did run, so the zeros here
  // are outcomes rather than a tick that never started.
  expect(summary.lanesRun).toBe(2);
  expect(summary.findingsPersisted).toBe(0);
  expect(h.findings.rows()).toEqual([]);
  expect(summariser.calls()).toBe(0);
});

// W16, a candidate that produced no finding is a fact the run row carries

test("candidates that produced no finding are recorded on the run row, with the floor's refusal kept apart from the gate's", async () => {
  // The no-key lane, so every candidate falls to the floor and the floor is the thing
  // under test. One candidate it cannot phrase, one the surface gate will not transmit,
  // one ordinary. The three outcomes that must not collapse.
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

  // The subject: both facts are on the row, not merely in this process's memory. A
  // tally that never reached `close` reads back as the zero the fake's `open` seeded,
  // so these assertions cannot pass by accident.
  //
  // Asserted as a pair, and the two numbers differ: "we could not phrase it" and "we
  // would not transmit it" are different answers about different points in the lane, so
  // a close that wrote one count into both columns, or swapped them, fails here rather
  // than telling a reader the floor failed when in fact the gate refused.
  const [run] = h.runs.rows();
  expect([run?.candidatesUnrenderable, run?.candidatesRefused]).toEqual([2, 1]);
  // The tick's own report agrees with the row it wrote.
  expect(summary.candidatesUnrenderable).toBe(2);
  expect(summary.candidatesRefused).toBe(1);

  // No sentence was invented for any of them. The count is what is persisted; the
  // refusal to phrase what could not honestly be phrased stands.
  expect(h.findings.rowFor(signatureOf(CANDIDATE_UNRENDERABLE_A))).toBeUndefined();
  expect(h.findings.rowFor(signatureOf(CANDIDATE_UNRENDERABLE_B))).toBeUndefined();
  // By surface, because the gate-refused candidate can hold no signature. See the same
  // assertion's explanation in the surface-gate test above.
  expect(h.findings.rows().some((row) => row.surface === CANDIDATE_LEAKY.surface)).toBe(false);
  // Isolation: the ordinary candidate still lands, and the run completes.
  expect(sourceFor(h, CANDIDATE_A)).toBe("floor_no_key_configured");
  expect(run?.status).toBe("completed");

  // The case that makes the column load-bearing: a run where every candidate fell out.
  // It still closes `completed` / `produced_findings` / `ran_to_completion`. That
  // direction is deliberate, because a broken run must not report the shape of an empty
  // product, and the row is the only place the reader can learn that nothing was
  // actually written. Without this column, "we lost all of them" and "we checked
  // everything" are the same row.
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
  // …and the row says so.
  expect(lostRun?.candidatesUnrenderable).toBe(1);
  expect(lostRun?.candidatesRefused).toBe(0);

  // Non-vacuity: the same lane with a candidate the floor can write up records zero in
  // both columns, so the ones above are the fixtures' doing.
  const clean = harness({ lanes: [lane({ candidates: [CANDIDATE_A] })], summariser: null });
  await runAnalysisTick(clean.deps);
  const [cleanRun] = clean.runs.rows();
  expect(cleanRun?.candidatesUnrenderable).toBe(0);
  expect(cleanRun?.candidatesRefused).toBe(0);
  expect(clean.findings.rows()).toHaveLength(1);
});

// W17, an attempted call is attributed on every path, throws included

test("a summariser that throws still attributes the model it addressed on both the finding and the run", async () => {
  // The port is contracted never to throw, so this path is defensive, which is a reason
  // to make it correct cheaply, not a reason to leave it lying. A throw loses the
  // result, never the knowledge of which model was addressed: the composition root
  // resolved that id and handed it over beside the port.
  const summariser = countingSummariser(() => {
    throw new Error("o11-summariser-contract-violation");
  });
  const h = harness({ summariser });

  await runAnalysisTick(h.deps);

  //  the finding. `findings.resolved_model_id` is documented as null iff no
  //  call was attempted for the candidate. A call was attempted here, so a
  //  null would make this row indistinguishable from the no-key lane's.
  const row = h.findings.rowFor(signatureOf(CANDIDATE_A));
  expect(row?.summarySource).toBe("floor_model_call_failed");
  expect(row?.resolvedModelId).toBe(MODEL_ID);
  expect(row?.resolvedModelId).not.toBeNull();

  //  the run, one level up. `applyAttribution` aggregates the same value, so
  //  the shape this test rules out is a run closing with
  //  `modelCallsAttempted > 0` beside a null model id — the same rule broken
  //  on a second column by the same missing id.
  const [run] = h.runs.rows();
  expect(run?.modelCallsAttempted).toBe(1);
  expect(run?.resolvedModelId).toBe(MODEL_ID);
  expect(run?.resolvedModelId).not.toBeNull();

  //  the CAP was still consumed. The claim precedes the call, so a project
  //  cannot buy unlimited retries by throwing.
  expect(h.runs.claimed()).toEqual([signatureOf(CANDIDATE_A)]);

  //  NULL still means something. The control: the no-key lane attempts no
  //  call, and both columns are null there. Without this the assertions
  //  above would also pass against a handler that stamped a model id on
  //  everything, which would destroy the distinction from the other side.
  const noKey = harness({ summariser: null });
  await runAnalysisTick(noKey.deps);
  expect(noKey.findings.rowFor(signatureOf(CANDIDATE_A))?.resolvedModelId).toBeNull();
  expect(noKey.runs.rows()[0]?.modelCallsAttempted).toBe(0);
  expect(noKey.runs.rows()[0]?.resolvedModelId).toBeNull();
});

// W18–W21, the identity the walker derives
//
// Everything the lane claims about itself hangs off one column. The cap is a lifetime
// ceiling only if the key is content-derived; `findings` is "one row per problem, never
// twice" only if the key is content-derived; the reuse rung fires only if the key is
// content-derived. v1's prescribed an ordinal prefixed by the tick instant, which would
// have made all three sentences false while every test above this line stayed green,
// because none of them drives the walker twice, and "same input twice" is exactly what
// the identity-churn rule says proves nothing. These four close that.

/** A second PROJECT in the same organisation. `projectId` is an input to the signature,
 * so a walker that dropped it would collide two projects' identical problems onto one
 * row behind a unique index that reports no error. */
const OTHER_PROJECT = "o11-project-elsewhere";

/**
 * The churn event's instant: one cron hour after `TICK_AT`, because the task is
 * scheduled `0 * * * *` and "the next tick" is the mutation asks about. Distinct from
 * `TICK_AT` so W19 can prove the second drive really did run at a different instant
 * rather than assert an unchanged identity against an unchanged clock.
 */
const SECOND_TICK_AT = new Date(TICK_AT.getTime() + 60 * 60 * 1000);

/**
 * A second tick over the same ports. Same findings store, same claim ledger, same
 * counting summariser, and a new instant and a new lane order.
 *
 * The fakes are shared deliberately: a fresh harness would prove nothing about an
 * identity's stability, because a fresh store cannot fork a row it never held. This is
 * what makes W19 a sequence rather than two independent runs.
 */
function nextTick(h: Harness, at: Date, lanes: readonly AnalysisLane[]): AnalysisTickDeps {
  return { ...h.deps, lanes: laneSource(lanes), now: () => at };
}

/** Whether the product's one producer will mint a permanent identity for this candidate
 * at all. W20's premise, and the right-hand side of its agreement assertion. Asked of
 * the real `computeFindingSignature`, never of a copy of its rule. */
function canEnterAPermanentIdentity(subject: CandidateFinding): boolean {
  try {
    signatureOf(subject);
    return true;
  } catch {
    return false;
  }
}

// W18, one producer, and the walker uses it

test("the signature the walker derives for a candidate is the one computeFindingSignature produces", async () => {
  // Two lanes in one tick, sharing a candidate. The second lane is what makes
  // `projectId` a tested input rather than an assumed one: `CANDIDATE_A` is the same
  // object in both, so the only thing that can separate the two rows is the project the
  // walker hashed with.
  const h = harness({
    lanes: [
      lane({ candidates: [CANDIDATE_A, CANDIDATE_B] }),
      lane({ projectId: OTHER_PROJECT, candidates: [CANDIDATE_A] }),
    ],
  });

  await runAnalysisTick(h.deps);

  //  the subject. The `signature` column is read off the store and compared
  //  to values computed independently through the public producer. Nothing
  //  here is a lookup: the walker was handed no key, so if it
  //  composed `signatureTuple` and `sha256Hex` a second time — or hashed a
  //  different field set — these strings would simply differ.
  const persisted = h.findings.rows();
  expect(persisted.map((row) => row.signature)).toEqual([
    signatureIn(PROJECT, CANDIDATE_A),
    signatureIn(PROJECT, CANDIDATE_B),
    signatureIn(OTHER_PROJECT, CANDIDATE_A),
  ]);

  //  non-vacuity for: the three expected strings are three different
  //  strings, so the equality above could fail. Two of them differ only by
  //  project — the collision a dropped `projectId` would cause, which the
  //  unique index on `(organization_id, project_id, signature)` would then
  //  hide as a silent conflict rather than report as an error.
  expect(new Set(persisted.map((row) => row.signature)).size).toBe(3);
  expect(signatureIn(PROJECT, CANDIDATE_A)).not.toBe(signatureIn(OTHER_PROJECT, CANDIDATE_A));

  //  paired with the version that produced it. `signature_version` is stored
  //  beside `signature` so a later serialiser bump can tell v1 rows apart
  //  from v2 ones; a walker that stamped a constant of its own would detach
  //  the two the first time the tuple forks.
  expect(persisted.map((row) => row.signatureVersion)).toEqual([
    SIGNATURE_TUPLE_VERSION,
    SIGNATURE_TUPLE_VERSION,
    SIGNATURE_TUPLE_VERSION,
  ]);

  //  one value at both sites, asserted as an equality between two sequences
  //  the handler recorded independently — the cap claim's ledger and the
  //  findings store. This is the "no second hashing path" in the only
  //  form that can fail: two derivations that disagreed would show up as two
  //  different strings here even if each was internally consistent.
  expect(h.runs.claimAttempts()).toEqual(persisted.map((row) => row.signature));

  //  and it is a content hash, not an ordinal and not a tick-instant prefix
  //  (v1, overruled). A 64-character hex digest is what the one
  //  producer returns; anything positional would fail this shape outright.
  for (const row of persisted) {
    expect(row.signature).toMatch(/^[\da-f]{64}$/);
  }
});

// W19, the test: the identity survives the churn event

test("the same candidate derives the same signature across two ticks with different instants and different orderings", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_B] })],
    summariser,
    cap: 12,
  });

  await runAnalysisTick(h.deps);

  // The row ids minted by the first tick. Identity is proven by the row being the same
  // row afterwards, not merely by a count that happens to match: a store that forked
  // and a store that reused both hold two rows if one of the originals was replaced.
  const idsAfterFirst = new Map(h.findings.rows().map((row) => [row.signature, row.id]));
  expect([...idsAfterFirst.keys()]).toEqual([signatureOf(CANDIDATE_A), signatureOf(CANDIDATE_B)]);
  expect(summariser.calls()).toBe(2);

  // The churn event, both halves applied at once a different instant (an hour later, as
  // the cron schedules it) and a different ordering: A moves from position 0 to
  // position 2, B from 1 to 0. `CANDIDATE_C` is new, and it is the control, see.
  await runAnalysisTick(
    nextTick(h, SECOND_TICK_AT, [
      lane({ candidates: [CANDIDATE_B, CANDIDATE_C, CANDIDATE_A] }),
    ]),
  );

  //  the mutation really landed. Both halves of it, asserted before
  //  anything is concluded from their absence of effect. A test that
  //  re-drove an unchanged clock and an unchanged order would be vacuous,
  //  which is the specific way "same input twice" fails to prove.
  const runs = h.runs.rows();
  expect(runs).toHaveLength(2);
  expect(runs[0]?.finishedAt).toEqual(TICK_AT);
  expect(runs[1]?.startedAt).toEqual(SECOND_TICK_AT);
  expect(runs[1]?.finishedAt).toEqual(SECOND_TICK_AT);
  //  …and the second tick offered its candidates in its own order, which is
  //  not the first tick's.
  expect(h.runs.claimAttempts().slice(2)).toEqual([
    signatureOf(CANDIDATE_B),
    signatureOf(CANDIDATE_C),
    signatureOf(CANDIDATE_A),
  ]);

  //  one claim per problem, for the project's lifetime. Five offers, three
  //  claims. Under an ordinal-plus-instant key this would be five, and a
  //  ceiling of twelve per project would silently have become twelve per
  //  hour while the ledger truthfully recorded one claim per row.
  expect(h.runs.claimed()).toEqual([
    signatureOf(CANDIDATE_A),
    signatureOf(CANDIDATE_B),
    signatureOf(CANDIDATE_C),
  ]);

  //  one finding row per problem, and the same row, by id. A fork would
  //  re-tell a customer something they have already read, under a new id,
  //  every hour, forever.
  expect(h.findings.rows()).toHaveLength(3);
  expect(h.findings.rowFor(signatureOf(CANDIDATE_A))?.id).toBe(
    idsAfterFirst.get(signatureOf(CANDIDATE_A)),
  );
  expect(h.findings.rowFor(signatureOf(CANDIDATE_B))?.id).toBe(
    idsAfterFirst.get(signatureOf(CANDIDATE_B)),
  );

  //  the control, and the whole reason `CANDIDATE_C` is in the second lane:
  //  the second tick was not a no-op. A genuinely new problem minted a new
  //  identity, took a claim and cost exactly one model call, while the two
  //  that had been seen before cost none. Without this, every zero above
  //  would also be satisfied by a handler that skipped the second tick.
  expect(summariser.calls()).toBe(3);
  expect(summariser.surfaces()).toEqual([
    CANDIDATE_A.surface,
    CANDIDATE_B.surface,
    CANDIDATE_C.surface,
  ]);
  expect(h.findings.rowFor(signatureOf(CANDIDATE_C))?.summarySource).toBe("model_rendered");

  //  and both runs closed TERMINAL. A replay must not leave the
  //  project's lane held behind the partial unique index.
  for (const run of runs) {
    expect(TERMINAL).toContain(String(run.status));
  }
});

// W20, a candidate with no possible identity costs the run nothing

test("a candidate whose surface cannot enter a permanent identity is refused without aborting the run", async () => {
  // The premise, stated first and against the real producer. This candidate has no
  // permanent identity available to it at all: `computeFindingSignature` refuses to
  // hash a surface that is not already its own normalised form, because the value would
  // be baked into a row this design never rewrites.
  expect(canEnterAPermanentIdentity(CANDIDATE_LEAKY)).toBe(false);
  // …and it refuses NO ordinary fixture, so the refusal below is attributable to the
  // surface rather than to a producer that refuses everything.
  for (const accepted of [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C]) {
    expect(canEnterAPermanentIdentity(accepted)).toBe(true);
  }

  const summariser = cleanSummariser();
  // Mid-lane, with work on both sides of it. A candidate already claimed and written
  // sits before it, and one not yet reached sits after, so a refusal that travelled as
  // a throw would cost this project both: the first loses its finding to a failed run,
  // the second is never walked at all. The existing surface-gate test puts the refused
  // candidate first, where neither loss is possible.
  const h = harness({
    lanes: [lane({ candidates: [CANDIDATE_A, CANDIDATE_LEAKY, CANDIDATE_B] })],
    summariser,
  });

  const summary = await runAnalysisTick(h.deps);

  //  both sides survived, and each reached the top rung. The one before it
  //  was not rolled back, the one after it was not skipped.
  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  expect(sourceFor(h, CANDIDATE_B)).toBe("model_rendered");
  expect(summariser.surfaces()).toEqual([CANDIDATE_A.surface, CANDIDATE_B.surface]);
  expect(h.findings.rows()).toHaveLength(2);

  //  the run is TERMINAL, and terminal in the ordinary way. A refusal is not
  //  a failure: `failed` here would tell a founder their check broke when in
  //  fact it ran, and `running` would jam the project's lane forever.
  const [run] = h.runs.rows();
  expect(TERMINAL).toContain(String(run?.status));
  expect(run?.status).toBe("completed");
  expect(run?.stopReason).toBe("ran_to_completion");
  expect(run?.failureReason).toBeNull();
  expect(run?.finishedAt).toEqual(TICK_AT);

  //  counted as a refusal and not as a rendering complaint, on the row as
  //  well as in the tick's report. "We would not transmit it" and "we could
  //  not phrase it" are answers about different points in the lane.
  expect([run?.candidatesRefused, run?.candidatesUnrenderable]).toEqual([1, 0]);
  expect(summary.candidatesRefused).toBe(1);
  expect(summary.candidatesUnrenderable).toBe(0);
  expect(summary.findingsPersisted).toBe(2);

  //  the agreement that keeps– TRUE. The candidates the walker
  //  offered to the cap are exactly the candidates the one producer will
  //  mint an identity for — no fewer (the gate refuses nothing the producer
  //  would accept, so a working candidate is never silently dropped) and no
  //  more (a candidate with no identity never reaches a claim, a call or a
  //  row). The two predicates are asserted against each other rather than
  //  each against a fixture, so a gate loosened out of step with the
  //  producer fails here instead of quietly making the derivation's refusal
  //  the live path.
  const walked = [CANDIDATE_A, CANDIDATE_LEAKY, CANDIDATE_B];
  expect(h.runs.claimAttempts()).toEqual(
    walked.filter(canEnterAPermanentIdentity).map((subject) => signatureOf(subject)),
  );
});

// W21, the port carries candidates and nothing else

test("the analysis lane port carries candidate findings and no separate key", async () => {
  //  the assertion is the compile itself. `@ts-expect-error` is a failing
  //  directive when the error it names does not occur, so each one below is
  //  a live assertion that `bun run typecheck` refuses the shape. That is
  //  the whole point of: a key on this port would be a hand-passed
  //  field between an unbuilt producer and three consumers, and the one way
  //  to know a wire nobody can drive is disconnected is to make it
  //  impossible to declare. A runtime check would not do — a stray
  //  property is silently ignored at runtime, which is precisely how the
  //  wire looks connected while carrying nothing.

  // The wrapper v1 assumed: `{ candidateKey, candidate }`. Deleted.
  const wrapped: AnalysisLane["candidates"] = [
    // @ts-expect-error: a lane item is a CandidateFinding, never a
    // wrapper carrying a key beside it.
    { candidateKey: "o11-supplied-key", candidate: CANDIDATE_A },
  ];
  expect(wrapped).toHaveLength(1);

  // Nor does a key travel beside the candidates, one level up.
  const keyedLane: AnalysisLane = {
    ...lane(),
    // @ts-expect-error: the lane carries no key of its own either.
    candidateKey: "o11-supplied-key",
  };
  expect(keyedLane.projectId).toBe(PROJECT);

  //  what the port does carry, checked against the schema that owns the
  //  shape rather than against a look-alike declared here: every lane item
  //  re-parses as a `CandidateFinding`. And a key handed over anyway has
  //  nowhere to land — the element's own schema does not carry the field, so
  //  it does not survive the parse.
  const carried = lane().candidates;
  expect(carried).toEqual([CANDIDATE_A]);
  expect(candidateFindingSchema.parse(carried[0])).toEqual(CANDIDATE_A);
  expect(
    candidateFindingSchema.parse({ ...CANDIDATE_A, candidateKey: "o11-supplied-key" }),
  ).not.toHaveProperty("candidateKey");

  //  and the walker still keys every site, from a lane that supplied
  //  nothing. This is the half that makes worth having: removing the
  //  field is only an improvement if the value still exists downstream, so
  //  the claim ledger and the finding row are read back and both name the
  //  identity the walker derived for itself.
  const h = harness({ lanes: [lane()] });

  await runAnalysisTick(h.deps);

  expect(h.runs.claimAttempts()).toEqual([signatureOf(CANDIDATE_A)]);
  expect(h.findings.rows().map((row) => row.signature)).toEqual([signatureOf(CANDIDATE_A)]);
});

// ---------------------------------------------------------------------------
// W22–W23 — THE runAnalysisLane EXTRACTION (O-008 AD-9, ADD §9)
//
// AD-22: the wave that owns the code owns the suite update. This suite is the
// pre-existing guard for that refactor, and the twenty-one rows above are the
// bulk of the proof — every one of them still drives `runAnalysisTick` and
// still asserts what it asserted before. NONE WAS RELAXED. The two rows below
// add what the existing ones structurally cannot say: that the summary survived
// the fold moving out of the lane, and that the one intentional behavioural
// change actually happened.
//
// WHY THE EXTRACTION EXISTS AT ALL. `runAnalysisLane` is now reached by two
// callers — this hourly tick, and the onboarding trigger that fires seconds
// after a founder breaks their own product. FR-O17 says the fast path "respects
// the single-writer index AND the cap ledger, or it does not ship", and names a
// cap-bypassing trigger a FINANCIAL COMMITMENT. The strongest form of that
// promise is not a careful second implementation; it is that there is only ONE
// implementation, and the trigger contributes a project id to it.
// ---------------------------------------------------------------------------

/** A project whose run another worker already holds, and a project that breaks
 *  mid-walk — so W22's summary is folded from THREE lanes with three different
 *  outcomes rather than from one, which is the only version of this row that
 *  could catch a fold silently dropping a member. */
const HELD_PROJECT = "o11-project-held";
const BREAKING_PROJECT = "o11-project-breaking";

// W22 — the refactor is behaviour-preserving, stated as one exact object.
test("runAnalysisTick produces the same summary after runAnalysisLane is extracted", async () => {
  const summariser = cleanSummariser();
  const h = harness({
    summariser,
    lanes: [
      // Completes, one finding.
      lane(),
      // Another worker holds it — `already_running`, and the ONE outcome that
      // now folds a tally of four zeroes rather than skipping the fold. A
      // refactor that folded it as anything else shows up here.
      lane({ projectId: HELD_PROJECT }),
      // Fails mid-walk, having already refused one candidate before it broke —
      // so `failed` still has to REPORT the work it did. A lane returning an
      // empty tally on failure would surface as a missing `candidatesRefused`.
      lane({
        projectId: BREAKING_PROJECT,
        candidates: [CANDIDATE_LEAKY, CANDIDATE_B],
        sessionsConsidered: 30,
      }),
    ],
  });

  // The incumbent, seeded through the repository's OWN open so it is exactly the
  // row the partial unique index will refuse ours against.
  await h.runs.repoFor(OTHER_WORKER).open({
    projectId: HELD_PROJECT,
    tickAt: INCUMBENT_STARTED_AT,
  });
  // The store stops answering for the third lane's one renderable candidate.
  h.findings.breakOn(signatureIn(BREAKING_PROJECT, CANDIDATE_B));

  const summary = await runAnalysisTick(h.deps);

  // EVERY FIELD, AS ONE OBJECT. A field-by-field walk lets a member the fold
  // silently stopped carrying pass unnoticed; `toEqual` on the whole summary
  // cannot. This is the pin the extraction is judged against.
  expect(summary).toEqual({
    lanesConsidered: 3,
    // The completed lane and the failed lane both OPENED a run; the held one
    // did not.
    lanesRun: 2,
    lanesAlreadyRunning: 1,
    lanesFailed: 1,
    lanesErrored: 0,
    findingsPersisted: 1,
    candidatesUnrenderable: 0,
    // The leaky surface, refused before the ladder — counted on the FAILED
    // lane, which is the half proving a failure still reports its work.
    candidatesRefused: 1,
    // TWO, NOT ONE, AND THE SECOND IS THE POINT. The failing lane spent a model
    // call on `CANDIDATE_B` before its persist broke, and that spend is real
    // money that must reach the summary even though no finding did. A fold that
    // dropped a failed lane's tally would report ONE here and the cap would
    // silently stop being accounted for on every broken run.
    modelCallsAttempted: 2,
  } satisfies AnalysisTickSummary);

  // AND THE PERSISTED FACTS AGREE WITH THE REPORTED ONES. A summary is a
  // report; if the two disagreed, only one of them would be true and this row
  // could not say which.
  expect(h.findings.rows()).toHaveLength(1);
  expect(
    h.runs
      .rows()
      .filter((row) => row.status === "running")
      .map((row) => row.projectId),
  ).toEqual([HELD_PROJECT]);
});

// W23 — the ONE intentional behavioural change, and the structural guarantee
// that came with it.
test("runAnalysisLane returns its tally rather than mutating a shared summary", async () => {
  const summariser = cleanSummariser();
  const h = harness({ summariser });

  // (1) THE SUMMARY PARAMETER IS GONE, PROVEN BY ARITY. The old private
  //     `runLane(deps, summary, lane, tickAt)` took four arguments, the second
  //     of which was the caller's accumulator. Three is the assertion: a runner
  //     that mutates its caller's object cannot be called by anyone who does
  //     not have one, which is exactly the position the onboarding trigger is
  //     in.
  expect(runAnalysisLane).toHaveLength(3);

  // (2) IT TAKES THE LANE'S DEPS, NOT THE TICK'S. `lanes` is deliberately
  //     absent from `AnalysisLaneDeps`: a lane runner that could still reach
  //     the lane SOURCE could widen its own work from one project to the whole
  //     installation, which is precisely the second pipeline AD-9 exists to
  //     make impossible. The annotation is explicit rather than inferred,
  //     because passing the wider object would prove nothing about what the
  //     narrower type permits.
  const { lanes: _tickOnlySource, ...laneOnlyDeps } = h.deps;
  const deps: AnalysisLaneDeps = laneOnlyDeps;

  // (3) THE VALUE COMES BACK. Driven through the real exported entry point,
  //     with no accumulator anywhere in the call.
  const result = await runAnalysisLane(deps, lane(), TICK_AT);

  expect(result.outcome).toBe("completed");
  expect(result.tally).toEqual({
    findingsPersisted: 1,
    unrenderable: 0,
    refused: 0,
    modelCallsAttempted: 1,
  });

  // (4) AND THE RETURNED COUNTS ARE THE PERSISTED ONES. Read back off the store
  //     and off the closed run row, never off a value this file handed over — a
  //     tally reporting numbers the run row does not carry would be a second,
  //     disagreeing home for the same facts.
  expect(h.findings.rows()).toHaveLength(1);
  expect(sourceFor(h, CANDIDATE_A)).toBe("model_rendered");
  const closed = h.runs.rows()[0];
  expect(closed?.status).toBe("completed");
  expect(closed?.modelCallsAttempted).toBe(result.tally.modelCallsAttempted);
  expect(closed?.candidatesRefused).toBe(result.tally.refused);
  expect(closed?.candidatesUnrenderable).toBe(result.tally.unrenderable);

  // (5) THE ZERO TALLY IS A REAL VALUE, NOT AN ABSENT ONE. `already_running`
  //     does no work and must still hand back four numbers, so every caller
  //     folds unconditionally and no branch has to remember to skip it.
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
  // NO TERMINAL WRITE ONTO SOMEBODY ELSE'S RUN — the reason `already_running`
  // returns early at all, re-asserted here because the extraction moved that
  // return.
  expect(held.runs.rows()).toHaveLength(1);
  expect(held.runs.rows()[0]?.status).toBe("running");
});
