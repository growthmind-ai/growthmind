// THE LADDER (AD-9) — one candidate's turn, start to finish.
//
// One rung per branch, in the one order the failure classes cannot collapse in,
// and every branch returns a plan rather than throwing.
//
//   no key            -> floor_no_key_configured       [0 claims, 0 calls]
//   cap spent         -> floor_cap_exhausted           [0 calls]
//   already claimed   -> reuse the persisted finding   [0 calls, no 2nd row]
//   call_failed       -> floor_model_call_failed       [claim consumed]
//   output_invalid    -> floor_model_output_invalid    [claim consumed]
//   guard rejected    -> floor_model_text_rejected     [claim consumed]
//   otherwise         -> model_rendered
//
// ONE CALL SITE PER RUNG, and the order is the contract. Three properties fall
// out of it and out of nothing else:
//
//   - THE KEY CHECK PRECEDES THE CLAIM, so an installation with no key consumes
//     zero budget. The branch SELECTS the no-key lane; it never tries and fails
//     (AD-15). `deps.summariser` is `null` there and no port is reached for.
//   - THE CLAIM PRECEDES THE CALL, so a FAILED call still consumes the cap
//     (FR-M6). A project cannot buy unlimited retries by failing.
//   - `output_invalid` AND `text_rejected` NEVER COLLAPSE (D10). "The shape
//     could not be read" and "the prose asserted something it may not" are
//     different debugging signals and different sentences to a customer. They
//     are two branches, in that order, reachable only in that order: the guard
//     runs ONLY over text the output schema has already parsed.
//
// The only throws that escape are from the CLAIM and the reuse READ — the two
// database calls. Those are lane-fatal by design: a claim that cannot be taken
// means the cap cannot be accounted for, and continuing without it would spend
// budget nobody can count.
import type { CandidateFinding, FloorSummarySource } from "@growthmind/core";
import {
  guardModelText,
  joinSentences,
  modelSummaryOutputSchema,
  splitSentences,
} from "@growthmind/core";
import type { AnalysisRunRecord, AnalysisRunsRepo, FindingsRepo } from "@growthmind/db";
import type { SummaryRenderResult } from "@growthmind/shared";
import { describeError } from "@growthmind/shared";

import { floorAction, floorTextFor, identityFor, surfaceIsSafeToSend } from "./gates";
import { summariseInputFor } from "./shapes";
import type { AnalysisLane, AnalysisTickDeps, CallAttribution, CandidatePlan } from "./types";
import { NO_CALL } from "./types";

export async function planCandidate(
  deps: AnalysisTickDeps,
  lane: AnalysisLane,
  runs: AnalysisRunsRepo,
  findings: FindingsRepo,
  run: AnalysisRunRecord,
  candidate: CandidateFinding,
  position: number,
  tickAt: Date,
): Promise<CandidatePlan> {
  // ── GATE 0: THE SURFACE. NOT A RUNG — it stands before the whole ladder, and
  //    before rung 1 rather than beside it, because the no-key lane persists a
  //    finding too and `persist` is an egress point in its own right. It also
  //    stands before the IDENTITY DERIVATION below, which hashes the surface
  //    into a permanent value and is therefore an egress point of the same kind.
  //    Refusing here is the only position from which zero claims, zero calls,
  //    zero rows and zero signatures are all guaranteed by construction rather
  //    than by every branch below remembering to check. See
  //    `surfaceIsSafeToSend`.
  if (!surfaceIsSafeToSend(position, lane.projectId, candidate, deps.logger)) {
    return { capExhausted: false, action: { kind: "refused" } };
  }

  // ── THE IDENTITY, DERIVED ONCE AND BEFORE THE CLAIM (AD-20). Every site below
  //    that keys on this candidate — the cap claim, the reuse read, the
  //    persist — names THIS value, so the three can never disagree. A refusal
  //    here is a per-candidate refusal and never a run abort (AD-20.5).
  const identity = identityFor(position, lane.projectId, candidate, deps.logger);
  if (identity === null) {
    return { capExhausted: false, action: { kind: "refused" } };
  }

  const floorPlanFor = (
    source: FloorSummarySource,
    attribution: CallAttribution,
    capExhausted = false,
  ): CandidatePlan => {
    const floor = floorTextFor(identity.signature, candidate, source, deps.logger);
    return {
      capExhausted,
      action: floor === null ? { kind: "unrenderable" } : floorAction(floor, attribution, identity),
    };
  };

  // ── RUNG 1: NO KEY. The branch SELECTS this lane (AD-15); it does not try a
  //    port and swallow the failure. Zero claims and zero calls follow from the
  //    key check standing BEFORE the claim, and from nothing else.
  if (deps.summariser === null) {
    return floorPlanFor("floor_no_key_configured", NO_CALL);
  }

  // The port AND the id it addresses, taken together and once. Every branch
  // below that records an attempt attributes it to THIS id — see
  // `ConfiguredSummariser`.
  const summariser = deps.summariser;

  // ── RUNG 2: THE CAP CLAIM. One conditional insert, NO prior read (D6). Both
  //    count predicates and the unique index are evaluated together, so two
  //    overlapping runs cannot both conclude there is budget, and its three
  //    answers stay distinguishable without a check-then-write window.
  //
  //    TWO CEILINGS, ONE RUNG (AD-23). The per-project limit and the
  //    organisation-wide one are handed over together and refuse with the same
  //    answer, so there is no fourth rung and no second sentence: which ceiling
  //    stopped a candidate is not a distinction the shipped vocabulary can
  //    express, and inventing one here would author a customer-facing string
  //    outside `@growthmind/shared`.
  const claim = await runs.claimModelCall({
    projectId: lane.projectId,
    runId: run.id,
    signature: identity.signature,
    signatureVersion: identity.signatureVersion,
    projectCap: deps.projectCap,
    organizationCap: deps.organizationCap,
    at: tickAt,
  });

  if (!claim.claimed) {
    if (claim.reason === "cap_exhausted") {
      // ── RUNG 3: THE CAP IS SPENT. The candidate is STILL PERSISTED, with the
      //    numbers and without prose, and the run will say it stopped early.
      return floorPlanFor("floor_cap_exhausted", NO_CALL, true);
    }

    // ── RUNG 4: ALREADY CLAIMED. A previous run — or a Graphile Worker replay
    //    of this very job — owns this candidate's budget. Calling again would
    //    be billed twice and would overwrite text a customer may already have
    //    read, so this rung makes NO call under any circumstance. With a
    //    content-derived identity this is also the rung that makes "one finding
    //    per problem per project" hold across TICKS and not merely across a
    //    replay: a later tick re-deriving the same signature lands here.
    const existing = await findings.findBySignature(lane.projectId, identity.signature);
    if (existing !== null) {
      deps.logger.info(
        `analysis tick: candidate ${identity.signature} was already written up by an earlier run, so this tick left it alone`,
      );
      return { capExhausted: false, action: { kind: "reuse" } };
    }

    // The claim stands but no finding does — a run that stopped between the two.
    // The budget is gone and may not be re-spent, so the finding lands at the
    // floor. `floor_model_call_failed` is the honest member: a written
    // explanation was attempted for this candidate and did not complete. The
    // model id is unknown to us — the attempt was another run's, and inventing
    // an id would attribute text to a model nobody can vouch for.
    deps.logger.error(
      `analysis tick: candidate ${identity.signature} was claimed by an earlier run that recorded no finding, so it is being written up without one`,
    );
    return floorPlanFor("floor_model_call_failed", NO_CALL);
  }

  // ── RUNG 5: THE CALL. The claim is spent from here on, whatever happens.
  let result: SummaryRenderResult;
  try {
    result = await summariser.port.render(summariseInputFor(candidate));
  } catch (error) {
    // The port is CONTRACTED never to throw — it degrades by return value. A
    // port somebody breaks anyway must not become a run stuck `running`, and
    // must not cost the finding: the candidate falls to the floor exactly as a
    // returned `call_failed` would. The thrown text is OURS to log and never
    // the customer's to read.
    deps.logger.error(
      `analysis tick: candidate ${identity.signature} threw while being written up — ${describeError(error)}`,
    );
    return floorPlanFor("floor_model_call_failed", {
      attempted: true,
      // ATTRIBUTED, even here. A throw loses the RESULT, not the knowledge of
      // which model was addressed — the composition root resolved that id and
      // handed it over beside the port, so this path records the same id every
      // other attempt does. Writing `null` instead would make an attempted call
      // indistinguishable from one that was never made, on two columns whose
      // headers promise otherwise (AD-5).
      resolvedModelId: summariser.resolvedModelId,
      usage: {},
    });
  }

  const attribution: CallAttribution = {
    attempted: true,
    resolvedModelId: result.resolvedModelId,
    usage: result.usage,
  };

  if (!result.ok) {
    // The port's two mechanisms, kept apart all the way to the persisted row:
    // a shape failure is not a transport failure, and a customer reading either
    // sentence is told something true about which one happened.
    const source: FloorSummarySource =
      result.code === "output_invalid" ? "floor_model_output_invalid" : "floor_model_call_failed";
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} has no written explanation — ${result.message}`,
    );
    return floorPlanFor(source, attribution);
  }

  // ── RUNG 6: THE SHAPE. Re-parsed HERE, against the same schema the adapter
  //    was handed, because what came back is external data (D5) and the
  //    `ok:true` arm's `headline`/`context` are only `z.string()`. An empty
  //    headline is a shape failure, not text for the guard to judge.
  const parsed = modelSummaryOutputSchema.safeParse({
    headline: result.headline,
    context: result.context,
  });
  if (!parsed.success) {
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} came back in a shape that could not be read as a written explanation`,
    );
    return floorPlanFor("floor_model_output_invalid", attribution);
  }

  // ── RUNG 7: THE SAC GUARD, over the text AS IT WILL BE PERSISTED.
  //    Segmented first, so the array stored below is the very array judged; the
  //    guard is handed the join of those sentences and nothing else. Prose no
  //    honest segmentation exists for is itself a rejection (AD-7) — unjudged
  //    text does not reach a customer.
  const sentences = splitSentences(parsed.data.context);
  if (sentences === null) {
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} came back as prose that could not be checked one sentence at a time, so it was left out`,
    );
    return floorPlanFor("floor_model_text_rejected", attribution);
  }

  const verdict = guardModelText({
    candidate,
    headline: parsed.data.headline,
    context: joinSentences(sentences),
  });
  if (!verdict.ok) {
    // THE RULE AND THE POSITION, NEVER THE TEXT. The offending string carries a
    // customer's page path and their counts; the rule id and the element index
    // are enough to find it and are facts about this code rather than about
    // somebody's product (AD-7).
    const offences = verdict.offences
      .map((offence) => `${offence.sac}@${String(offence.element)}`)
      .join(", ");
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} had a written explanation that did not pass the accuracy check (${verdict.refusal}${offences === "" ? "" : `: ${offences}`}), so it was left out`,
    );
    return floorPlanFor("floor_model_text_rejected", attribution);
  }

  // ── RUNG 8: MODEL RENDERED. The headline as the model wrote it, the context
  //    as the guard judged it, sentence by sentence.
  return {
    capExhausted: false,
    action: {
      kind: "persist",
      identity,
      summary: {
        summarySource: "model_rendered",
        headline: parsed.data.headline,
        context: sentences,
        attribution,
      },
    },
  };
}
