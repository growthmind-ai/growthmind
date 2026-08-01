/**
 * THE ONBOARDING FAST PATH (O-008 AD-11b, FR-O16, FR-O17).
 *
 * A founder connects their analytics, breaks something in their own product on
 * purpose, and watches. The hourly `analysis:tick` cron would make them wait up
 * to an hour for the one moment the product exists for. This task is the same
 * analysis, asked for ONE project, seconds after their broken request reached
 * us.
 *
 * A plain exported async function with no queue types in its signature.
 * Registration and enqueueing live in ../index.ts, the only queue-aware file.
 *
 * ── WHAT THIS FILE CONTRIBUTES: A PROJECT ID. THAT IS THE WHOLE LIST ────────
 * FR-O17 says the fast path "respects the single-writer index AND the cap
 * ledger, or it does not ship", and names a cap-bypassing trigger a FINANCIAL
 * COMMITMENT. The strongest available form of that promise is not a careful
 * implementation of the claim here — it is that THERE IS NO MODEL-CALL SITE
 * HERE TO GET WRONG.
 *
 * `runAnalysisLane` (`./analysis-tick.ts`) is the code that opens the run
 * against `analysis_runs_one_open_per_project_key`, takes the cap claim under
 * BOTH ceilings, walks the eight-rung degradation ladder, and closes the run
 * terminally on every exit path. This file resolves a lane and calls it.
 *
 * So this file contains — and must keep containing — no cap-claim call site, no
 * finding write, and neither half of a run's open/close pair. A source scan with
 * a planted-offender control enforces exactly that, by looking for those four
 * call sites BY NAME; this comment therefore describes them rather than spelling
 * them, because a scan that a comment can trip is a scan nobody can trust. If a
 * change here appears to need one of them, R-AD9 has been broken and FR-O17 is
 * never-cut and financial.
 *
 * ── THE PAYLOAD CARRIES NO SCOPE, AND CANNOT (EC-O7, D7) ────────────────────
 * `onboardingAnalysisPayloadSchema` declares `projectId` and refuses everything
 * else. There is no `organizationId` to trust and no `userId` to impersonate, so
 * the only place a tenant scope can come from is the project's own row, which
 * `laneForProject` reads. A value that cannot arrive cannot be mis-scoped.
 *
 * The schema is STRICT rather than merely narrow, and that distinction is
 * measured rather than assumed: a plain `z.object()` returns `success: true` for
 * a body carrying a client-supplied `organizationId` and SILENTLY STRIPS it, and
 * `Object.keys(schema.shape)` is identical for both constructors. Enumeration
 * proves a key is undeclared; only `.strict()` proves the schema refuses one.
 *
 * ── FAIL DIRECTION: TOWARD THE CRON, NEVER TOWARD SILENCE (AD-12, D10) ──────
 * Every failure mode of this path — a payload that will not parse, a project
 * with no lane, a run another worker already holds, a cap already spent, a
 * store that stops answering — leaves the project's ordinary hourly
 * `analysis:tick` ENTIRELY UNCHANGED. NOTHING HERE WRITES A MARKER THAT
 * SUPPRESSES, DEDUPLICATES AWAY OR RESCHEDULES THE CRON'S OWN RUN: no
 * next-analysis timestamp, no "already handled" flag, no stamped watermark. A
 * trigger that consumed the project's turn would convert a TRANSIENT MISS into a
 * PERMANENT HOLE, which is the one direction a pre-model gate may never fail in.
 * A source scan enforces this too, by looking for every column and flag name
 * such a marker could plausibly use — which is the second reason this comment
 * names none of them.
 *
 * `already_running` is an ORDINARY OUTCOME here, not an error. The partial
 * unique index refusing a second run IS the single-writer guarantee working, and
 * surfacing it as a fault would show a founder a fracture in a system behaving
 * exactly as designed. The abandoned-run hazard is mitigated by INHERITANCE
 * rather than by anything written here: the repository's own reclaim takes over
 * any `running` row older than `ANALYSIS_RUN_LEASE_MS` (45 minutes), and this
 * path reaches it through the very same lane runner the cron uses. That
 * inheritance is the second reason AD-9 reuses `runAnalysisLane` instead of
 * writing a lane runner beside it.
 */
import { z } from "zod";

import type { AnalysisLaneDeps, AnalysisLaneSource, LaneRunResult } from "./analysis-tick";
import { runAnalysisLane } from "./analysis-tick";

/**
 * The queued payload, and the whole of it.
 *
 * `.strict()` is REQUIRED, not stylistic. Its absence is invisible to key
 * enumeration and turns a refusal into a silent strip — see the header. The one
 * declared key is a project id, and `.min(1)` is there because an empty string
 * is a project id nothing can resolve and a lookup that quietly finds nothing
 * reads as "this project has no lane" rather than as "this payload was junk".
 */
export const onboardingAnalysisPayloadSchema = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();

export type OnboardingAnalysisPayload = z.infer<typeof onboardingAnalysisPayloadSchema>;

/**
 * The trigger's dependencies: everything ONE lane run needs, plus the source
 * that can build a lane for one project.
 *
 * `lanes` is present here and deliberately ABSENT from `AnalysisLaneDeps` — this
 * task may ask for a named project's lane, and the lane runner it then calls may
 * not ask for anything at all. That asymmetry is what stops a runner widening
 * its own work from one project to the whole installation.
 */
export interface OnboardingAnalysisDeps extends AnalysisLaneDeps {
  readonly lanes: AnalysisLaneSource;
}

/**
 * What one trigger did. Returned for the caller's log line and for tests;
 * NOTHING downstream branches on it, and nothing is persisted from it — the run
 * row is the durable record, written by `runAnalysisLane`.
 *
 * `no_lane` and `invalid_payload` are distinct members rather than one "nothing
 * happened": the first is an ordinary answer about a project, the second is a
 * defect in whatever queued the job, and collapsing them would hide a broken
 * producer inside a quiet product.
 */
export type OnboardingAnalysisResult =
  | { readonly kind: "ran"; readonly projectId: string; readonly lane: LaneRunResult }
  | { readonly kind: "no_lane"; readonly projectId: string }
  | { readonly kind: "invalid_payload" };

export async function runOnboardingAnalysis(
  deps: OnboardingAnalysisDeps,
  payload: unknown,
): Promise<OnboardingAnalysisResult> {
  const parsed = onboardingAnalysisPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    // NOT A THROW. A malformed payload is a defect in the producer, and letting
    // it throw would make Graphile Worker retry a job that can never succeed —
    // twenty-five times, for a body that will be identical every time. Logged
    // loudly instead; the hourly cron analyses this installation regardless, so
    // the cost of the bad payload is bounded to the delay it caused (AD-12).
    //
    // The payload is NOT logged. It is external input and this line goes to our
    // logs, not a customer's; a rejected body is exactly the shape most likely
    // to carry something nobody vetted.
    deps.logger.error(
      "analysis onboarding: a queued trigger carried a payload this task cannot read, so it was dropped — the hourly check still covers this installation",
    );
    return { kind: "invalid_payload" };
  }

  const { projectId } = parsed.data;

  // THE TENANT SCOPE IS READ FROM THE PROJECT'S OWN ROW, inside the source.
  // Nothing in this call carries an organisation, so there is nothing for a
  // caller to have supplied one through — the same discipline the scheduled
  // path already follows, and the reason the payload declares no such key.
  //
  // The instant is `deps.now()`, taken ONCE and threaded into both the lane
  // build and the run, so the corpus window and the abandoned-run lease are
  // evaluated against the same moment.
  const at = deps.now();
  const lane = await deps.lanes.laneForProject(projectId, at);

  if (lane === null) {
    // GRACEFUL ABSENCE, and NOT a run. An empty lane would open a run and close
    // it, which is a different and false claim — "we looked" — about a project
    // we could not even assemble a corpus for. Nothing is written, nothing is
    // suppressed, and the hourly cron's own turn is untouched.
    deps.logger.info(
      `analysis onboarding: project ${projectId} has no lane to check right now, so this trigger did nothing and the hourly check is unaffected`,
    );
    return { kind: "no_lane", projectId };
  }

  // THE ONE CALL. Everything financial — both ceilings, the single-writer
  // index, the terminal close — happens inside it and nowhere else.
  const result = await runAnalysisLane(deps, lane, at);

  if (result.outcome === "already_running") {
    // The guarantee WORKING, said plainly. `runAnalysisLane` has already logged
    // the lane's own line; this one names the trigger so a reader can tell a
    // fast-path collision from a cron collision.
    deps.logger.info(
      `analysis onboarding: project ${projectId} was already being checked, so this trigger left it alone`,
    );
    return { kind: "ran", projectId, lane: result };
  }

  deps.logger.info(
    `analysis onboarding: project ${projectId} checked on the fast path — ${result.outcome}, findings ${String(result.tally.findingsPersisted)}, asked a model to write up ${String(result.tally.modelCallsAttempted)}, not written up at all ${String(result.tally.unrenderable)}, turned away before we looked at them ${String(result.tally.refused)}`,
  );

  return { kind: "ran", projectId, lane: result };
}

/**
 * Why there is no try/catch around the body above.
 *
 * `runAnalysisLane` already closes its run terminally on every path it owns, and
 * the faults that can still escape it — a repository factory that throws, a
 * context that will not build, a store that stopped answering before the run was
 * opened — are faults this task cannot repair and must not hide. Letting them
 * escape is what makes Graphile Worker retry the job, which is the correct
 * response to a transient store fault and is bounded by the queue's own attempt
 * limit.
 *
 * The one asymmetry worth stating (Wave 0a, measured): when a SECOND trigger for
 * the same project lands while this job is running, graphile-worker strips this
 * job's key and forces its `attempts` to `max_attempts` — so a failure AFTER
 * that point is permanent rather than retried. That does not break AD-12: the
 * replacement job carries the work, and the hourly cron is the floor regardless.
 * NOTHING MAY ASSERT THAT A FAILED ONBOARDING JOB IS RETRIED — the claim is
 * false the moment a second trigger lands.
 */
