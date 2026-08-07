import type { DeliveryCandidate, DeliveryLaneState, SlackMessageInput } from "@growthmind/core";
import {
  decideDelivery,
  deliveryClaimsExpireBefore,
  renderSlackMessage,
  renderedMessageOf,
  scanResidualPii,
  toBlockKit,
} from "@growthmind/core";
import type { DeliveriesRepo, DeliveryDecisionsRepo, SignatureHex } from "@growthmind/db";
import { describeDriverError } from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextFor } from "@growthmind/db/system";
import type {
  DeliveryLaneDecision,
  DeliveryPoster,
  DeliveryReasonCode,
  PostRequest,
  PostResult,
  RenderedMessage,
  TenantContext,
} from "@growthmind/shared";
import {
  DELIVERY_VOCABULARY,
  NOT_DELIVERED_REASON_CODE,
  deliveryReasonSentence,
  describeError,
  laneDecisionReasonCode,
  nothingTodayReasonCode,
  postFailureReasonCode,
  residualPiiReasonCode,
} from "@growthmind/shared";

import type { TaskLogger } from "../task-logger";

const COULD_NOT_POST: string = deliveryReasonSentence(NOT_DELIVERED_REASON_CODE);

export type DeliveryLogger = TaskLogger;

export const DELIVERY_ACTOR_ID = SYSTEM_ACTOR.DELIVERY_TICK;

export type DeliverMessageInput = Extract<SlackMessageInput, { decision: "deliver" }>;

export type DeliverableFinding = DeliveryCandidate & {
  readonly signature: SignatureHex;
  readonly message: DeliverMessageInput;
};

export type DeliveryLane = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly projectId: string;
   
  readonly channelId: string;
   
  readonly deliveredThisWeek: number;
  readonly candidates: readonly DeliverableFinding[];
};

export interface DeliveryLaneSource {
   
  listDueLanes(now: Date): Promise<readonly DeliveryLane[]>;
}

export type DeliveriesRepoFor = (ctx: TenantContext) => DeliveriesRepo;

export type DeliveryDecisionsRepoFor = (ctx: TenantContext) => DeliveryDecisionsRepo;

export type DeliveryPosterFor = (ctx: TenantContext) => Promise<DeliveryPoster | null>;

export interface DeliveryTickDeps {
  lanes: DeliveryLaneSource;
  deliveriesFor: DeliveriesRepoFor;
  decisionsFor: DeliveryDecisionsRepoFor;
  posterFor: DeliveryPosterFor;

  now: () => Date;
  logger: DeliveryLogger;
}

export interface DeliveryTickSummary {
   
  lanesConsidered: number;
   
  posted: number;
   
  failed: number;
   
  blockedByPii: number;
   
  nothingToday: number;
   
  notClaimed: number;
   
  notConnected: number;
   
  lanesErrored: number;
}

type LaneOutcome = DeliveryLaneDecision;

// What one lane concluded, carried out of `runLane` as a value rather than acted on inside
// it: one caller writes the decision row, so no exit path can be added that records nothing.
type LaneDecision = {
  readonly outcome: LaneOutcome;
  readonly reasonCode: DeliveryReasonCode;
  readonly reason: string;
  readonly findingId: string | null;
  readonly channelId: string | null;
};

type PreparedPost =
  | { readonly ok: true; readonly request: PostRequest; readonly rendered: RenderedMessage }
  | { readonly ok: false; readonly reasonCode: DeliveryReasonCode; readonly outcome: LaneOutcome };

export interface ScannableText {
  readonly text: string | null;

  readonly cause: string | null;
}

export function textPostedFor(request: PostRequest): ScannableText {
  try {
    return { text: `${request.fallbackText}\n${JSON.stringify(request.blocks)}`, cause: null };
  } catch (error) {
    // A serialisation throw is a renderer bug, not a PII block. Discarding it made the
    // two indistinguishable in the logs, and the outcome counts it as blocked_by_pii.
    return { text: null, cause: describeError(error) };
  }
}

function prepare(
  finding: DeliverableFinding,
  lane: DeliveryLane,
  logger: DeliveryLogger,
): PreparedPost {
  let request: PostRequest;
  let rendered: RenderedMessage;
  try {
    // One render, two frames: Block Kit goes to Slack, the same message goes onto the
    // delivery row. Rendering twice would let the two disagree, which is the whole hazard.
    const message = renderSlackMessage(
      { ...finding.message, findingId: finding.findingId },
      DELIVERY_VOCABULARY,
    );
    rendered = renderedMessageOf(message);
    request = {
      channelId: lane.channelId,
      // Slack is handed Block Kit, never Growthmind's intermediate model.
      blocks: toBlockKit(message.blocks),

      fallbackText: message.text,
    };
  } catch (error) {
    logger.error(
      `delivery tick: finding ${finding.findingId} could not be rendered — ${describeError(error)}`,
    );
    return { ok: false, reasonCode: NOT_DELIVERED_REASON_CODE, outcome: "failed" };
  }

  const scannable = textPostedFor(request);
  if (scannable.text === null) {
    logger.error(
      `delivery tick: finding ${finding.findingId} produced a message the residual check could not read, so it was held back — ${scannable.cause ?? "no cause reported"}`,
    );
    return { ok: false, reasonCode: NOT_DELIVERED_REASON_CODE, outcome: "blocked_by_pii" };
  }

  const scan = scanResidualPii(scannable.text);
  const [first] = scan.findings;
  if (!scan.clean && first) {
     
    logger.error(
      `delivery tick: finding ${finding.findingId} was held back — generated text contained something shaped like a ${first.kind}`,
    );
    return {
      ok: false,
      reasonCode: residualPiiReasonCode(first.kind),
      outcome: "blocked_by_pii",
    };
  }

  return { ok: true, request, rendered };
}

function tenantContextFor(lane: DeliveryLane): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.DELIVERY_TICK, lane);
}

// The code picks the sentence, so a lane cannot store a pair built from two switches that
// drift apart, and rewording the sentence cannot change what the record treats as one run.
function decided(
  outcome: LaneOutcome,
  parts: { reasonCode?: DeliveryReasonCode; findingId?: string; channelId?: string } = {},
): LaneDecision {
  const reasonCode = parts.reasonCode ?? laneDecisionReasonCode(outcome);

  return {
    outcome,
    reasonCode,
    reason: deliveryReasonSentence(reasonCode),
    findingId: parts.findingId ?? null,
    channelId: parts.channelId ?? null,
  };
}

// The decision row is a side effect of the lane, not part of it: a record that cannot be
// written must not turn a delivered finding into a failed tick (D8).
async function recordDecision(
  deps: DeliveryTickDeps,
  lane: DeliveryLane,
  decision: LaneDecision,
  decidedAt: Date,
): Promise<void> {
  try {
    const written = await deps.decisionsFor(tenantContextFor(lane)).record({
      projectId: lane.projectId,
      decision: decision.outcome,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      findingId: decision.findingId,
      channelId: decision.channelId,
      decidedAt,
    });

    if (!written.recorded) {
      deps.logger.info(
        `delivery tick: project ${lane.projectId} decided ${decision.outcome}, and another run had already recorded ${written.run.decision} for the same lane, so this one was left alone`,
      );
    }
  } catch (error) {
    deps.logger.error(
      `delivery tick: project ${lane.projectId} decided ${decision.outcome}, and that decision could not be recorded — ${describeDriverError(error)}`,
    );
  }
}

async function recordFailed(
  deps: DeliveryTickDeps,
  deliveries: DeliveriesRepo,
  input: { findingId: string; channelId: string; reason: string },
): Promise<void> {
  try {
    const row = await deliveries.markFailed({
      findingId: input.findingId,
      channelId: input.channelId,
      failedAt: deps.now(),
      reason: input.reason,
    });
    if (row === null) {
      deps.logger.error(
        `delivery tick: finding ${input.findingId} could not be recorded as failed — no matching delivery was open`,
      );
    }
  } catch (error) {
    deps.logger.error(
      `delivery tick: finding ${input.findingId} failed to post AND its failure could not be recorded — ${describeDriverError(error)}`,
    );
  }
}

async function runLane(
  deps: DeliveryTickDeps,
  lane: DeliveryLane,
  tickAt: Date,
): Promise<LaneDecision> {
  const ctx = tenantContextFor(lane);

  const poster = await deps.posterFor(ctx);

  if (poster === null) {
    deps.logger.info(
      `delivery tick: org ${lane.organizationId} has no delivery channel connected, so project ` +
        `${lane.projectId} was left alone this tick`,
    );
    return decided("not_connected");
  }

  const deliveries = deps.deliveriesFor(ctx);

  // One instant for both the read and the claim below, so a lease cannot read as expired
  // here and still in flight there.
  const staleClaimsBefore = deliveryClaimsExpireBefore(tickAt);

  const pending = await deliveries.listPendingForProject(lane.projectId, staleClaimsBefore);

  const state: DeliveryLaneState = {
    openFindingIds: pending.map((row) => row.findingId),
    deliveredThisWeek: lane.deliveredThisWeek,
    candidates: lane.candidates,
  };

  const decision = decideDelivery(state, tickAt);

  if (decision.decision === "nothing_today") {
    deps.logger.info(
      `delivery tick: project ${lane.projectId} has nothing to send today — ${decision.reason}`,
    );
    // The reason, not the lead sentence: a founder asking why it has been quiet is asking
    // which of the three quiet days this was, and collapsing runs by reason keeps them apart.
    return decided("nothing_today", {
      reasonCode: nothingTodayReasonCode(decision.reason),
      channelId: lane.channelId,
    });
  }

  const chosen = lane.candidates.find(
    (candidate) => candidate.findingId === decision.finding.findingId,
  );
  if (!chosen) {
    deps.logger.error(
      `delivery tick: project ${lane.projectId} chose finding ${decision.finding.findingId}, which is not in its own candidate list`,
    );
    return decided("unresolvable", { channelId: lane.channelId });
  }

  const prepared = prepare(chosen, lane, deps.logger);

  const claim = await deliveries.claimForPost({
    projectId: lane.projectId,
    findingId: chosen.findingId,
    signature: chosen.signature,
    channelId: lane.channelId,
    claimedAt: tickAt,
    staleClaimsBefore,
  });

  const about = { findingId: chosen.findingId, channelId: lane.channelId };

  if (!claim.claimed) {
    deps.logger.info(
      `delivery tick: finding ${chosen.findingId} is already being delivered by another run, so this tick left it alone`,
    );
    return decided("not_claimed", about);
  }

  if (!prepared.ok) {
    await recordFailed(deps, deliveries, {
      findingId: chosen.findingId,
      channelId: lane.channelId,
      reason: deliveryReasonSentence(prepared.reasonCode),
    });
    return decided(prepared.outcome, { ...about, reasonCode: prepared.reasonCode });
  }

  let result: PostResult;
  try {
    result = await poster.post(prepared.request);
  } catch (error) {
    deps.logger.error(
      `delivery tick: finding ${chosen.findingId} threw while posting — ${describeError(error)}`,
    );
    await recordFailed(deps, deliveries, {
      findingId: chosen.findingId,
      channelId: lane.channelId,
      reason: COULD_NOT_POST,
    });
    return decided("failed", { ...about, reasonCode: NOT_DELIVERED_REASON_CODE });
  }

  if (!result.ok) {
    // The customer-facing reason is composed from `result.code`, never echoed from
    // `result.message`: a closed union is provably free of any Slack response body,
    // and it lets this lane append a next action the first-run screen must not carry.
    deps.logger.error(
      `delivery tick: finding ${chosen.findingId} was not accepted by the channel — ${result.code}`,
    );
    const reasonCode = postFailureReasonCode(result.code);
    await recordFailed(deps, deliveries, {
      findingId: chosen.findingId,
      channelId: lane.channelId,
      reason: deliveryReasonSentence(reasonCode),
    });
    return decided("failed", { ...about, reasonCode });
  }

  try {
    const row = await deliveries.markPosted({
      findingId: chosen.findingId,
      channelId: lane.channelId,
      postedAt: deps.now(),
      messageRef: result.messageRef,
      renderedMessage: prepared.rendered,
    });
    if (row === null) {
      deps.logger.error(
        `delivery tick: finding ${chosen.findingId} posted, but no delivery row was there to record it against`,
      );
    }
  } catch (error) {

    deps.logger.error(
      `delivery tick: finding ${chosen.findingId} posted, but the delivery could not be recorded as posted — ${describeDriverError(error)}`,
    );
    // A delivery left `pending` is spoken for by the lane source forever and carries no
    // message reference, so nothing a reader presses on the live message resolves it.
    // `failed` is the only terminal state still reachable here, and it is the same answer
    // the throwing-poster branch gives: the next tick re-posts and the finding is
    // actionable again, at the cost of one repeated message.
    await recordFailed(deps, deliveries, {
      findingId: chosen.findingId,
      channelId: lane.channelId,
      reason: COULD_NOT_POST,
    });
    return decided("failed", { ...about, reasonCode: NOT_DELIVERED_REASON_CODE });
  }

  return decided("posted", about);
}

function applyOutcome(summary: DeliveryTickSummary, outcome: LaneOutcome): void {
  switch (outcome) {
    case "posted":
      summary.posted += 1;
      return;
    case "failed":
      summary.failed += 1;
      return;
    case "blocked_by_pii":
       
      summary.failed += 1;
      summary.blockedByPii += 1;
      return;
    case "nothing_today":
      summary.nothingToday += 1;
      return;
    case "not_claimed":
      summary.notClaimed += 1;
      return;
    case "not_connected":
      summary.notConnected += 1;
      return;
    case "unresolvable":
    case "lane_errored":
      summary.lanesErrored += 1;
      return;
  }
}

export async function runDeliveryTick(deps: DeliveryTickDeps): Promise<DeliveryTickSummary> {
  const tickAt = deps.now();
  const lanes = await deps.lanes.listDueLanes(tickAt);

  const summary: DeliveryTickSummary = {
    lanesConsidered: lanes.length,
    posted: 0,
    failed: 0,
    blockedByPii: 0,
    nothingToday: 0,
    notClaimed: 0,
    notConnected: 0,
    lanesErrored: 0,
  };

  if (lanes.length === 0) {
    return summary;
  }

  for (const lane of lanes) {
    let decision: LaneDecision;

    try {
      decision = await runLane(deps, lane, tickAt);
    } catch (error) {
      deps.logger.error(
        `delivery tick: project ${lane.projectId} could not be processed — ${describeDriverError(error)}`,
      );
      // The branch the record exists for: a lane that threw is the shape a dead worker takes
      // from a founder's side, and it is the one shape a log-only trace cannot answer.
      decision = decided("lane_errored");
    }

    applyOutcome(summary, decision.outcome);
    await recordDecision(deps, lane, decision, tickAt);
  }

  deps.logger.info(
    `delivery tick: lanes ${summary.lanesConsidered}, posted ${summary.posted}, failed ${summary.failed} (${summary.blockedByPii} held back), nothing today ${summary.nothingToday}, already claimed ${summary.notClaimed}, no channel connected ${summary.notConnected}, errored ${summary.lanesErrored}`,
  );

  return summary;
}
