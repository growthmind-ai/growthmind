// Produces the lanes `runDeliveryTick` consumes. The channel is read off
// `slack_connections`, never supplied by a caller, so a cross-org post is impossible.
import {
  COUNT_ROLES,
  beatsFromActions,
  confidenceBasisSchema,
  deliveryClaimsExpireBefore,
  toMeasuredCount,
  worthOf,
  type CauseBeatEvidence,
  type ConfidenceBasis,
  type CountRole,
  type DeliveredCause,
  type DeliveredCauseClaim,
  type DetectorName,
  type GrowthContext,
} from "@growthmind/core";
import type {
  CauseClaimRecord,
  CauseClaimsRepo,
  DeliveryRecord,
  FindingRecord,
  MeasuredCountRow,
  RecordingSummariesRepo,
  ScopedDb,
  SessionRecordingCitation,
  SignatureHex,
  SignatureLedgerService,
} from "@growthmind/db";
import {
  createCauseClaimsRepo,
  createDeliveriesRepo,
  createFindingsRepo,
  createGrowthContextRepo,
  createProjectsRepo,
  createRecordingSummariesRepo,
  describeDriverError,
  describeHold,
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
import { citesLabel, describeError } from "@growthmind/shared";
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

// A row that can never become a message spends no slot, so the read has to reach past
// those rows to fill the lane. Fifty permanently-skipped rows would otherwise be a
// silent stop on every later finding this project produces.
export const FINDINGS_READ_PER_LANE = FINDINGS_CONSIDERED_PER_LANE * 4;

const DEFAULT_OBSERVATION_LABELS: Record<CountRole, string> = {
  reached_surface: "reached this step",
  left_without_continuing: "left without continuing",
  affected_sessions: "hit the error",
};

// Per-detector overrides for roles whose default copy doesn't fit. An observed struggle is not
// "hit the error" — that's error_event's framing (see count-roles.ts's own comment on this).
const OBSERVATION_LABEL_OVERRIDES: Partial<
  Record<DetectorName, Partial<Record<CountRole, string>>>
> = {
  observed_struggle: { affected_sessions: "showed struggle" },
};

function observationLabelFor(detector: DetectorName, role: CountRole): string {
  return OBSERVATION_LABEL_OVERRIDES[detector]?.[role] ?? DEFAULT_OBSERVATION_LABELS[role];
}

function contextFor(organization: SlackDeliveryOrganization): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.DELIVERY_TICK, organization);
}

type ScannedFindingText = Extract<FindingRecord["text"], { held: false }>;

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;

// Matches packages/core/src/replay/render.ts's own stamp format — the same third local copy
// apps/web/lib/findings/evidence.ts already carries, per that file's own comment. A citation's
// label has to read identically wherever it renders (web page or Slack message).
function stampOf(atMs: number): string {
  const totalSeconds = Math.floor(atMs / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function firstCitedBeat(
  beats: readonly CauseBeatEvidence[],
  citesBeats: readonly number[],
): CauseBeatEvidence | undefined {
  const index = citesBeats[0];
  return index === undefined ? undefined : beats[index];
}

// Same derivation as apps/web/lib/findings/evidence.ts's claimViewOf — a citation link is
// null (never a dead link) when the anchor session's own citation is unresolvable (D5).
function causeClaimLine(
  claim: CauseClaimRecord["claims"][number],
  beats: readonly CauseBeatEvidence[],
  citation: SessionRecordingCitation | undefined,
): DeliveredCauseClaim {
  const cited = firstCitedBeat(beats, claim.citesBeats);
  const href =
    citation === undefined || cited === undefined
      ? null
      : `/replays/${citation.recordingId}?t=${String(cited.atMs)}`;

  return {
    statement: claim.statement,
    citesHref: href,
    citesLabel: citesLabel(cited === undefined ? "" : stampOf(cited.atMs)),
  };
}

type CitationsForFn = (
  projectId: string,
  sessionIds: readonly string[],
) => Promise<readonly SessionRecordingCitation[]>;

// Only ever called for a finding whose cause_claims row exists (Decision 3's own predicate,
// re-checked here rather than re-derived differently) — a finding with no row never reaches
// this function, so DeliveredExplanation.cause stays entirely absent for it (the byte-identical
// regression guard packages/core/__tests__/delivery/slack-message.test.ts asserts).
async function causeFor(
  projectId: string,
  causeClaims: CauseClaimRecord,
  citationsFor: CitationsForFn,
): Promise<DeliveredCause> {
  if (causeClaims.claims.length === 0) {
    // The row only exists here when droppedClaims > 0 (Decision 3's table) — the gate
    // attempted the finding and emptied every claim.
    return { grade: "described", claims: [], droppedClaims: causeClaims.droppedClaims };
  }

  const citations = await citationsFor(projectId, [causeClaims.anchorSessionId]);
  const citation = citations.find((entry) => entry.sessionId === causeClaims.anchorSessionId);
  const beats: readonly CauseBeatEvidence[] =
    citation === undefined || citation.actions === null ? [] : beatsFromActions(citation.actions);

  return {
    grade: "explained",
    claims: causeClaims.claims.map((claim) => causeClaimLine(claim, beats, citation)),
    droppedClaims: causeClaims.droppedClaims,
  };
}

// A non-critical read (D8): a finding still delivers with no causal clause, exactly as it did
// before this stage existed, if the cause_claims lookup itself fails this tick.
async function causeClaimsForFinding(
  logger: DeliveryLogger,
  causeClaimsRepo: CauseClaimsRepo,
  finding: FindingRecord,
): Promise<CauseClaimRecord | null> {
  if (finding.summarySource !== "model_rendered") {
    return null;
  }

  try {
    return await causeClaimsRepo.findForFinding(finding.projectId, finding.id);
  } catch (error) {
    logger.error(
      `delivery lane source: finding ${finding.id} could not be checked for a causal claim this tick, so it will deliver without one — ${describeDriverError(error)}`,
    );
    return null;
  }
}

async function messageInputFor(
  finding: FindingRecord,
  text: ScannedFindingText,
  causeClaims: CauseClaimRecord | null,
  citationsFor: CitationsForFn,
): Promise<DeliverMessageInput | null> {
  const roles = COUNT_ROLES[finding.detector];
  if (finding.counts.length !== roles.length) {
    return null;
  }

  const observations = finding.counts.map((row, index) => {
    const role = roles[index] as CountRole;
    return { label: observationLabelFor(finding.detector, role), count: toMeasuredCount(row) };
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

  const context = text.context.join(" ").trim();
  if (text.headline.trim().length === 0 || context.length === 0) {
    return null;
  }

  if (causeClaims === null) {
    return {
      decision: "deliver",
      surfacePath: finding.surface,
      observations,
      explanation: { source: "model_rendered", headline: text.headline, context },
    };
  }

  const cause = await causeFor(finding.projectId, causeClaims, citationsFor);

  return {
    decision: "deliver",
    surfacePath: finding.surface,
    observations,
    explanation: { source: "model_rendered", headline: text.headline, context, cause },
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

async function deliverableFor(
  finding: FindingRecord,
  text: ScannedFindingText,
  growth: GrowthContext | null,
  logger: DeliveryLogger,
  causeClaimsRepo: CauseClaimsRepo,
  citationsFor: CitationsForFn,
): Promise<DeliverableFinding | null> {
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

  const causeClaims = await causeClaimsForFinding(logger, causeClaimsRepo, finding);

  let message: DeliverMessageInput | null;
  try {
    message = await messageInputFor(finding, text, causeClaims, citationsFor);
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

// ADD o-019-dismissal-wired Decision 4: declared locally rather than imported from
// worker/src/analysis/types.ts, whose AnalysisLaneDeps.ledgerFor has the identical
// shape — a sibling worktree (O-046) is concurrently modifying that file, and this
// alias is one line, so a new dependency edge onto it would cost more than it saves.
type SignatureLedgerFor = (ctx: TenantContext) => SignatureLedgerService;

export interface DeliveryLaneSourceDeps {
  readonly db: ScopedDb;
  readonly logger: DeliveryLogger;
  readonly ledgerFor: SignatureLedgerFor;
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
      const causeClaimsRepo = createCauseClaimsRepo(deps.db, ctx);
      const recordingSummaries: RecordingSummariesRepo = createRecordingSummariesRepo(
        deps.db,
        ctx,
      );

      // Read once per lane, not per finding, and read fresh every tick: a correction to
      // what a surface is worth reorders this queue on the next tick rather than from the
      // next finding onwards.
      const growth = await weightingFor(deps, ctx, projectId);

      const recent = await findings.listForProject(projectId, {
        limit: FINDINGS_READ_PER_LANE,
      });

      const candidates: DeliverableFinding[] = [];
      let deliveredThisWeek = 0;
      let considered = 0;

      for (const finding of recent) {
        if (considered >= FINDINGS_CONSIDERED_PER_LANE) {
          break;
        }

        // Before the dedup read, not after: the read is what would come back empty for a
        // finding the OLD channel already received.
        if (isBeforeCutover(finding, organization.deliveryCutoverAt)) {
          continue;
        }

        // Scanned on the same terms as a model-rendered row, and ahead of the
        // `summarySource` branch in `messageInputFor`, never instead of it. `warn`: a held
        // row repeats every tick for as long as it exists, and a level that fires forever
        // on a state the analysis lane already recorded is not an alarm.
        const text = finding.text;
        if (text.held) {
          const hold = describeHold(text);
          deps.logger.warn(
            `delivery lane source: finding ${finding.id} carries written text that must not be shown (${hold.reason}/${String(hold.kind)}), so it was held back`,
          );
          continue;
        }

        // Before the slot is spent, like the held-text check above: a dismissal is
        // permanent, so a dismissed row must never be one of the FINDINGS_CONSIDERED_PER_LANE
        // rows that stand between it and a project's real findings (ADD Decision 4). An
        // unreadable signature is left to deliverableFor()'s own validation further down.
        if (isSignatureHex(finding.signature)) {
          try {
            const decision = await deps
              .ledgerFor(ctx)
              .consultSignature(projectId, signatureHex(finding.signature));

            if (decision.decision === "suppress") {
              deps.logger.warn(
                `delivery lane source: finding ${finding.id} carries a signature the ledger resolved as ${decision.reason}, so it was held back`,
              );
              continue;
            }
          } catch (error) {
            // A thrown consult is not a resolved suppress decision (ADD Decision 3) — the
            // finding is held back this tick only, the same fail-toward-doubt rule the
            // analysis lane applies.
            deps.logger.error(
              `delivery lane source: finding ${finding.id} could not be checked against the dismissal ledger this tick, so it was held back — ${describeDriverError(error)}`,
            );
            continue;
          }
        }

        considered += 1;

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

        const deliverable = await deliverableFor(
          finding,
          text,
          growth,
          deps.logger,
          causeClaimsRepo,
          (recordProjectId, sessionIds) =>
            recordingSummaries.citationsFor(recordProjectId, sessionIds),
        );
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
