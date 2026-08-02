import type { DeliveryCandidate, DeliveryLaneState, SlackMessageInput } from "@growthmind/core";
import { decideDelivery, renderSlackMessage, scanResidualPii } from "@growthmind/core";
import type { DeliveriesRepo, SignatureHex } from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextFor } from "@growthmind/db/system";
import type { DeliveryPoster, PostRequest, PostResult, TenantContext } from "@growthmind/shared";
import {
  DELIVERY_STATUS_MESSAGES,
  DELIVERY_VOCABULARY,
  RESIDUAL_PII_KIND_MESSAGES,
  deliveryFailureSentence,
  describeError,
} from "@growthmind/shared";

const COULD_NOT_POST: string = requireSentence(
  DELIVERY_STATUS_MESSAGES.failed,
  "the delivery status 'failed'",
);

function requireSentence(sentence: string | null, subject: string): string {
  if (sentence === null) {
    throw new Error(`delivery tick: ${subject} has no sentence in @growthmind/shared`);
  }
  return sentence;
}

export interface DeliveryLogger {
  info(message: string): void;
  error(message: string): void;
}

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

export type DeliveryPosterFor = (ctx: TenantContext) => Promise<DeliveryPoster | null>;

export interface DeliveryTickDeps {
  lanes: DeliveryLaneSource;
  deliveriesFor: DeliveriesRepoFor;
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

type LaneOutcome =
  | "posted"
  | "failed"
  | "blocked_by_pii"
  | "nothing_today"
  | "not_claimed"
  | "not_connected"
  | "unresolvable";

type PreparedPost =
  | { readonly ok: true; readonly request: PostRequest }
  | { readonly ok: false; readonly reason: string; readonly outcome: LaneOutcome };

export function textPostedFor(request: PostRequest): string | null {
  try {
    return `${request.fallbackText}\n${JSON.stringify(request.blocks)}`;
  } catch {
    return null;
  }
}

function prepare(
  finding: DeliverableFinding,
  lane: DeliveryLane,
  logger: DeliveryLogger,
): PreparedPost {
  let request: PostRequest;
  try {
    const message = renderSlackMessage(finding.message, DELIVERY_VOCABULARY);
    request = {
      channelId: lane.channelId,
      blocks: message.blocks,
       
      fallbackText: message.text,
    };
  } catch (error) {
    logger.error(
      `delivery tick: finding ${finding.findingId} could not be rendered — ${describeError(error)}`,
    );
    return { ok: false, reason: COULD_NOT_POST, outcome: "failed" };
  }

  const scannable = textPostedFor(request);
  if (scannable === null) {
    logger.error(
      `delivery tick: finding ${finding.findingId} produced a message the residual check could not read, so it was held back`,
    );
    return { ok: false, reason: COULD_NOT_POST, outcome: "blocked_by_pii" };
  }

  const scan = scanResidualPii(scannable);
  const [first] = scan.findings;
  if (!scan.clean && first) {
     
    logger.error(
      `delivery tick: finding ${finding.findingId} was held back — generated text contained something shaped like a ${first.kind}`,
    );
    return {
      ok: false,
      reason: RESIDUAL_PII_KIND_MESSAGES[first.kind],
      outcome: "blocked_by_pii",
    };
  }

  return { ok: true, request };
}

function tenantContextFor(lane: DeliveryLane): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.DELIVERY_TICK, lane);
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
      `delivery tick: finding ${input.findingId} failed to post AND its failure could not be recorded — ${describeError(error)}`,
    );
  }
}

async function runLane(
  deps: DeliveryTickDeps,
  lane: DeliveryLane,
  tickAt: Date,
): Promise<LaneOutcome> {
  const ctx = tenantContextFor(lane);

  const poster = await deps.posterFor(ctx);

  if (poster === null) {
     
    deps.logger.info(
      `delivery tick: org ${lane.organizationId} has no delivery channel connected, so project ` +
        `${lane.projectId} was left alone this tick`,
    );
    return "not_connected";
  }

  const deliveries = deps.deliveriesFor(ctx);

  const pending = await deliveries.listPendingForProject(lane.projectId);

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
    return "nothing_today";
  }

  const chosen = lane.candidates.find(
    (candidate) => candidate.findingId === decision.finding.findingId,
  );
  if (!chosen) {
     
    deps.logger.error(
      `delivery tick: project ${lane.projectId} chose finding ${decision.finding.findingId}, which is not in its own candidate list`,
    );
    return "unresolvable";
  }

  const prepared = prepare(chosen, lane, deps.logger);

  const claim = await deliveries.claimForPost({
    projectId: lane.projectId,
    findingId: chosen.findingId,
    signature: chosen.signature,
    channelId: lane.channelId,
    claimedAt: tickAt,
  });

  if (!claim.claimed) {
     
    deps.logger.info(
      `delivery tick: finding ${chosen.findingId} is already being delivered by another run, so this tick left it alone`,
    );
    return "not_claimed";
  }

  if (!prepared.ok) {
     
    await recordFailed(deps, deliveries, {
      findingId: chosen.findingId,
      channelId: lane.channelId,
      reason: prepared.reason,
    });
    return prepared.outcome;
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
    return "failed";
  }

  if (!result.ok) {
    // The customer-facing reason is composed from `result.code`, never echoed from
    // `result.message`: a closed union is provably free of any Slack response body,
    // and it lets this lane append a next action the first-run screen must not carry.
    deps.logger.error(
      `delivery tick: finding ${chosen.findingId} was not accepted by the channel — ${result.code}`,
    );
    await recordFailed(deps, deliveries, {
      findingId: chosen.findingId,
      channelId: lane.channelId,
      reason: deliveryFailureSentence(result.code),
    });
    return "failed";
  }

  try {
    const row = await deliveries.markPosted({
      findingId: chosen.findingId,
      channelId: lane.channelId,
      postedAt: deps.now(),
      messageRef: result.messageRef,
    });
    if (row === null) {
      deps.logger.error(
        `delivery tick: finding ${chosen.findingId} posted, but no delivery row was there to record it against`,
      );
    }
  } catch (error) {
     
    deps.logger.error(
      `delivery tick: finding ${chosen.findingId} posted, but the delivery could not be recorded as posted — ${describeError(error)}`,
    );
  }

  return "posted";
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
    try {
      applyOutcome(summary, await runLane(deps, lane, tickAt));
    } catch (error) {
       
      deps.logger.error(
        `delivery tick: project ${lane.projectId} could not be processed — ${describeError(error)}`,
      );
      summary.lanesErrored += 1;
    }
  }

  deps.logger.info(
    `delivery tick: lanes ${summary.lanesConsidered}, posted ${summary.posted}, failed ${summary.failed} (${summary.blockedByPii} held back), nothing today ${summary.nothingToday}, already claimed ${summary.notClaimed}, no channel connected ${summary.notConnected}, errored ${summary.lanesErrored}`,
  );

  return summary;
}
