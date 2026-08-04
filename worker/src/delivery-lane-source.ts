// Produces the lanes `runDeliveryTick` consumes. The channel is read off
// `slack_connections`, never supplied by a caller, so a cross-org post is impossible.
import {
  COUNT_ROLES,
  confidenceBasisSchema,
  deliveryClaimsExpireBefore,
  toMeasuredCount,
  worthOf,
  type ConfidenceBasis,
  type CountRole,
  type GrowthContext,
} from "@growthmind/core";
import type {
  DeliveryRecord,
  FindingRecord,
  MeasuredCountRow,
  ScopedDb,
  SignatureHex,
} from "@growthmind/db";
import {
  createDeliveriesRepo,
  createFindingsRepo,
  createGrowthContextRepo,
  createProjectsRepo,
  describeDriverError,
  isDeliveryTarget,
  isSignatureHex,
  signatureHex,
} from "@growthmind/db";
import type { DeliveryTarget } from "@growthmind/db";
import type { SlackDeliveryOrganization } from "@growthmind/db/system";
import {
  SYSTEM_ACTOR,
  listOrgsWithActiveSlackConnection,
  systemContextFor,
} from "@growthmind/db/system";
import { describeError } from "@growthmind/shared";
import type { TenantContext } from "@growthmind/shared";

import type {
  DeliverMessageInput,
  DeliverableFinding,
  DeliveryLane,
  DeliveryLaneSource,
  DeliveryLogger,
} from "./tasks/delivery-tick";

export const DELIVERY_WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

export const FINDINGS_CONSIDERED_PER_LANE = 50;

const OBSERVATION_LABELS: Record<CountRole, string> = {
  reached_surface: "reached this step",
  left_without_continuing: "left without continuing",
  affected_sessions: "hit the error",
};

const ROLES_BY_ARITY: ReadonlyMap<number, readonly CountRole[] | null> = buildRolesByArity();

function buildRolesByArity(): ReadonlyMap<number, readonly CountRole[] | null> {
  const byArity = new Map<number, readonly CountRole[] | null>();

  for (const roles of Object.values(COUNT_ROLES) as readonly (readonly CountRole[])[]) {
    byArity.set(roles.length, byArity.has(roles.length) ? null : roles);
  }

  return byArity;
}

function contextFor(organization: SlackDeliveryOrganization): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.DELIVERY_TICK, organization);
}

function messageInputFor(finding: FindingRecord): DeliverMessageInput | null {
  const roles = ROLES_BY_ARITY.get(finding.counts.length) ?? null;
  if (roles === null) {
    return null;
  }

  const observations = finding.counts.map((row, index) => {
    const role = roles[index] ?? "affected_sessions";
    return { label: OBSERVATION_LABELS[role], count: toMeasuredCount(row) };
  });

  if (observations.length === 0) {
    return null;
  }

  if (finding.summarySource !== "model_rendered") {
    return {
      decision: "deliver",
      surfacePath: finding.surface,
      observations,
      explanation: { source: finding.summarySource },
    };
  }

  const context = finding.context.join(" ").trim();
  if (finding.headline.trim().length === 0 || context.length === 0) {
    return null;
  }

  return {
    decision: "deliver",
    surfacePath: finding.surface,
    observations,
    explanation: { source: "model_rendered", headline: finding.headline, context },
  };
}

function sampleSizeFor(counts: readonly MeasuredCountRow[]): {
  numerator: number;
  denominator: number;
} | null {
  const last = counts[counts.length - 1];
  if (last === undefined) {
    return null;
  }
  return { numerator: last.numerator, denominator: last.denominator };
}

function deliverableFor(
  finding: FindingRecord,
  growth: GrowthContext | null,
  logger: DeliveryLogger,
): DeliverableFinding | null {
  if (!isSignatureHex(finding.signature)) {
    logger.error(
      `delivery lane source: finding ${finding.id} carries a signature that is not a digest, so it was held back`,
    );
    return null;
  }
  const signature: SignatureHex = signatureHex(finding.signature);

  const confidence = confidenceBasisSchema.safeParse(finding.confidenceBasis);
  if (!confidence.success) {
    logger.error(
      `delivery lane source: finding ${finding.id} records a confidence basis this lane cannot read, so it was held back`,
    );
    return null;
  }
  const confidenceBasis: ConfidenceBasis = confidence.data;

  const sampleSize = sampleSizeFor(finding.counts);
  if (sampleSize === null) {
    logger.error(
      `delivery lane source: finding ${finding.id} carries no counts, so there is no magnitude to rank it on and it was held back`,
    );
    return null;
  }

  let message: DeliverMessageInput | null;
  try {
    message = messageInputFor(finding);
  } catch (error) {
    logger.error(
      `delivery lane source: finding ${finding.id} carries counts that could not be rebuilt — ${describeError(error)}`,
    );
    return null;
  }

  if (message === null) {
    logger.error(
      `delivery lane source: finding ${finding.id} could not be turned into a message this lane would send, so it was held back`,
    );
    return null;
  }

  return {
    findingId: finding.id,
    confidenceBasis,
    sampleSize,
    signature,
    message,
    worth: worthOf(growth, finding.surface),
  };
}

// `pending` means a tick is posting this right now — unless that tick died, in which case
// the row says "in progress" forever and this finding is never a candidate again. Treating
// an expired claim as spoken for is the other half of the deadlock: clearing the lane's
// `openFindingIds` alone would unblock the project and still never resend THIS finding.
function isSpokenFor(delivery: DeliveryRecord | null, staleClaimsBefore: Date): boolean {
  if (delivery === null || delivery.status === "failed") {
    return false;
  }

  if (delivery.status === "pending") {
    return delivery.claimedAt.getTime() >= staleClaimsBefore.getTime();
  }

  return true;
}

// The other half of a channel re-point. The delivery dedup key is `(finding, channel)`, so
// against a channel that has just replaced another EVERY earlier finding looks undelivered
// and the whole backlog would post again. `null` means the address has never moved.
export function isBeforeCutover(finding: { readonly createdAt: Date }, at: Date | null): boolean {
  return at !== null && finding.createdAt.getTime() <= at.getTime();
}

function wasPostedInWindow(delivery: DeliveryRecord | null, windowStart: Date, at: Date): boolean {
  if (delivery === null || delivery.status !== "posted" || delivery.postedAt === null) {
    return false;
  }
  const postedAt = delivery.postedAt.getTime();
  return postedAt >= windowStart.getTime() && postedAt <= at.getTime();
}

export interface DeliveryLaneSourceDeps {
  readonly db: ScopedDb;
  readonly logger: DeliveryLogger;
}

// Ordering is not delivery. This read failing must cost the lane its weighting and nothing
// else — inside the lane's own try it would cost the project every finding it was due.
async function weightingFor(
  deps: DeliveryLaneSourceDeps,
  ctx: TenantContext,
  projectId: string,
): Promise<GrowthContext | null> {
  try {
    return await createGrowthContextRepo(deps.db, ctx).findForProject(projectId);
  } catch (error) {
    deps.logger.error(
      `delivery lane source: project ${projectId} could not be weighted this tick, so its ` +
        `findings are ordered as if nothing had been said about them — ${describeDriverError(error)}`,
    );
    return null;
  }
}

export function createDeliveryLaneSource(deps: DeliveryLaneSourceDeps): DeliveryLaneSource {
  // `null` means this project's turn failed (D8), never "nothing to send" — that is
  // a lane with empty `candidates`. The parameter type IS the AD-4 guard: only an
  // organization `isDeliveryTarget` has already narrowed can reach this function, so
  // both channel reads below are plain string reads.
  async function laneFor(
    organization: DeliveryTarget<SlackDeliveryOrganization>,
    ctx: TenantContext,
    projectId: string,
    at: Date,
  ): Promise<DeliveryLane | null> {
    const windowStart = new Date(at.getTime() - DELIVERY_WEEK_MS);
    const staleClaimsBefore = deliveryClaimsExpireBefore(at);

    try {
      const findings = createFindingsRepo(deps.db, ctx);
      const deliveries = createDeliveriesRepo(deps.db, ctx);

      // Read once per lane, not per finding, and read fresh every tick: a correction to
      // what a surface is worth reorders this queue on the next tick rather than from the
      // next finding onwards.
      const growth = await weightingFor(deps, ctx, projectId);

      const recent = await findings.listForProject(projectId, {
        limit: FINDINGS_CONSIDERED_PER_LANE,
      });

      const candidates: DeliverableFinding[] = [];
      let deliveredThisWeek = 0;

      for (const finding of recent) {
        // Before the dedup read, not after: the read is what would come back empty for a
        // finding the OLD channel already received.
        if (isBeforeCutover(finding, organization.deliveryCutoverAt)) {
          continue;
        }

        // Keyed on the same `(finding, channel)` tuple the claim conflicts on. This is
        // why `findFor` still takes a `string` (AD-4 row 7): a null channel would not
        // error, it would match zero rows, so `isSpokenFor` answers false and the tick
        // re-sends a delivered finding every week with nothing in a log.
        const delivery = await deliveries.findFor(finding.id, organization.channelId);

        if (wasPostedInWindow(delivery, windowStart, at)) {
          deliveredThisWeek += 1;
        }

        if (isSpokenFor(delivery, staleClaimsBefore)) {
          continue;
        }

        const deliverable = deliverableFor(finding, growth, deps.logger);
        if (deliverable !== null) {
          candidates.push(deliverable);
        }
      }

      return {
        organizationId: organization.organizationId,
        organizationName: organization.organizationName,
        projectId,

        channelId: organization.channelId,
        deliveredThisWeek,
        candidates,
      };
    } catch (error) {
      deps.logger.error(
        `delivery lane source: skipping project ${projectId} (org ${organization.organizationId}) ` +
          `this tick: ${describeDriverError(error)}`,
      );
      return null;
    }
  }

  return {
    async listDueLanes(at: Date): Promise<readonly DeliveryLane[]> {
      const organizations = await listOrgsWithActiveSlackConnection(deps.db);
      const lanes: DeliveryLane[] = [];

      for (const organization of organizations) {
        // The only place this tick answers the null channel (AD-4): an active
        // installation can be mid-OAuth, a real token with no address yet. Narrowing
        // here, before a lane exists, keeps `DeliveryLane.channelId` a `string`.
        // `info`, never `error` — a founder mid-setup is not a fault, but "this
        // customer received nothing" must be answerable from the log.
        if (!isDeliveryTarget(organization)) {
          deps.logger.info(
            `delivery lane source: organization ${organization.organizationId} has a Slack ` +
              `workspace attached and no channel chosen, so there is nowhere to deliver`,
          );
          continue;
        }

        // `systemContextFor` can refuse a bad row, so the context build stays inside
        // this try: one unreadable organization must not cost the rest their delivery.
        let ctx: TenantContext;
        let projectIds: readonly string[];
        try {
          ctx = contextFor(organization);
          const projects = await createProjectsRepo(deps.db, ctx).list();
          projectIds = projects.map((project) => project.id);
        } catch (error) {
          deps.logger.error(
            `delivery lane source: skipping org ${organization.organizationId} this tick: ` +
              `${describeDriverError(error)}`,
          );
          continue;
        }

        for (const projectId of projectIds) {
          const lane = await laneFor(organization, ctx, projectId, at);
          if (lane !== null) lanes.push(lane);
        }
      }

      return lanes;
    },
  };
}
