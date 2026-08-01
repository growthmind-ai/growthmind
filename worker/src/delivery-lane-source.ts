// THE ADAPTER BEHIND THE DELIVERY LANE (O-008 AD-15) — the read this product
// has never had.
//
// `runDeliveryTick` has consumed `DeliveryLane`s through a port since O-007 and
// NOTHING IN PRODUCTION PRODUCED ONE. The scheduler, the renderer, the residual
// scanner, the deliveries ledger and the poster port all shipped green and all
// of it proven against fakes; `resolveDeliveryComposition()` returned `null`,
// so the tick logged "there is nothing to post" every fifteen minutes on every
// installation, forever. This module and `makePosterFor` in ./index.ts are the
// two halves of that wire, and this one is the lane read.
//
// D11 is the hazard the outcome exists to close, so say the wire out loud:
// `resolveDeliveryComposition()` in ./index.ts returns `createDeliveryLaneSource`,
// and from that moment the tick's graceful-absence line means "nobody has
// connected a channel", never "no producer was written".
//
// ── THE CHANNEL IS READ, NEVER SUPPLIED (FR-O13, D7) ────────────────────────
// FR-O13 is a tenancy requirement wearing a data-flow costume. A channel id
// that can arrive on a payload is a way to post one organization's finding into
// another organization's channel. So the factory takes `{ db, logger }`,
// `listDueLanes` takes an instant, and the channel comes off
// `slack_connections.channel_id` for the organization the lane belongs to.
// There is nowhere for a caller to put one, which makes the cross-organization
// post IMPOSSIBLE rather than merely forbidden.
//
// Since AD-4 that channel can be NULL — a workspace attached with no channel
// chosen yet — so `listDueLanes` puts every organization through
// `isDeliveryTarget` before a lane is built for it. Everything downstream of
// that one call, this file's two channel reads included, sees a plain `string`.
//
// Every read below is org-scoped BY CONSTRUCTION: the only unscoped call is
// `listOrgsWithActiveSlackConnection`, which is the population itself, and
// every repository underneath it is built from a `TenantContext` derived from
// the row that population returned. There is no hand-written aggregation and no
// raw query in this file — the D7 "path that steps outside the flow" is closed
// by not having one.
//
// ── PER-ORG AND PER-PROJECT ISOLATION (D8) ──────────────────────────────────
// This source runs BEFORE the tick's own per-lane loop, so a fault here is not
// covered by it: one organization's unreadable connection or one project's
// unreadable findings would otherwise cost every other customer their delivery.
// A failed organization is logged and skipped; a failed project is logged and
// skipped; the lane list carries everyone else.
import {
  COUNT_ROLES,
  confidenceBasisSchema,
  measuredCount,
  measuredCountInputSchema,
  type ConfidenceBasis,
  type CountRole,
  type MeasuredCount,
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
  createProjectsRepo,
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

/**
 * The window `deliveredThisWeek` is counted over, ending at the tick's own
 * instant.
 *
 * A TRAILING SEVEN DAYS, not a calendar week, and the difference is the whole
 * reason to state it. `DELIVERY_BUDGET_PER_WEEK` is a restraint promise
 * (product decisions §7: "one thing at a time, not a ranked list of twelve"),
 * and a calendar week resets at midnight on a fixed day — so a customer who
 * spent their budget on Sunday evening could receive the next one hours later,
 * which is exactly the burst the ceiling exists to prevent. A trailing window
 * never resets; it only ever forgets the oldest post.
 *
 * Derived from the INJECTED instant, so this module reads no clock by any
 * route and a replayed tick counts the same window.
 */
export const DELIVERY_WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * How many of a project's newest findings one tick considers.
 *
 * The scheduler posts AT MOST ONE finding per project per tick and at most
 * `DELIVERY_BUDGET_PER_WEEK` per week, so this is not a limit on what can be
 * delivered — it is a bound on the work of deciding. Newest-first is the right
 * order for both halves of that decision: the candidate the scheduler will
 * choose is ranked on evidence rather than age, and the deliveries the weekly
 * count is measured from all belong to findings written recently by
 * construction.
 *
 * A POLICY DEFAULT, not a contract, and exported so a composition test can pin
 * it. Its one real cost is stated plainly below at `laneFor`.
 */
export const FINDINGS_CONSIDERED_PER_LANE = 50;

/**
 * What each of a finding's counts DID, in plain English, with no number in it —
 * `Observation.label`, as `packages/core/src/delivery/slack-message.ts` defines
 * it.
 *
 * A SESSION IS NEVER A PERSON. Identity stitching does not exist in this
 * product, so none of these may say people, users, customers or visitors; the
 * renderer's own `describesPeople` gate would drop the message's prose for it,
 * and these labels sit beside the numbers where that gate does not reach.
 *
 * ── ONE HOME, AND THIS IS THE WRONG ONE (FLAGGED) ───────────────────────────
 * Every other fixed customer-facing string the delivery lane produces lives in
 * `packages/shared/src/delivery/messages.ts`, for the three reasons its header
 * gives — a single-file plain-English audit, no second copy to drift, and a
 * reviewer who has never read the code. These three belong there, keyed by
 * `CountRole` exactly as `FLOOR_COUNT_TEMPLATES` already is. They are here
 * because ADD §5 gives this wave `worker/` and gives `packages/` to Wave 2,
 * which has already shipped; moving them is a one-file change for whoever next
 * opens that package, and this paragraph is the note that says so.
 *
 * Total by construction: a fourth `CountRole` is a compile error here rather
 * than an `undefined` rendered into a founder's Slack (D9).
 */
const OBSERVATION_LABELS: Record<CountRole, string> = {
  reached_surface: "reached this step",
  left_without_continuing: "left without continuing",
  affected_sessions: "hit the error",
};

/**
 * A finding's counts, back in their roles.
 *
 * THE PROBLEM THIS SOLVES, STATED HONESTLY. `CandidateFinding.counts` is a
 * POSITIONAL array whose roles are declared per detector by `COUNT_ROLES`, and
 * `toCountRows` (`./analysis/shapes.ts`) persists it in that same order — but
 * `findings.counts` stores no role and `findings` has no detector column, so
 * the role is not on the row this module reads. `resolveCounts` cannot help
 * here: it takes a `CandidateFinding`, which carries the detector.
 *
 * What IS recoverable is the arity, and the arity is a key into the same table.
 * So the map is DERIVED from `COUNT_ROLES` rather than written beside it, and
 * an arity two detectors share resolves to `null` — a refusal, never a guess.
 *
 * FAIL DIRECTION: WITHHOLD, the scheduler's own direction. A finding whose
 * roles cannot be resolved is not delivered and is logged; the alternative is a
 * message labelling the arrival count as the departure count, which is a wrong
 * number nobody can see is wrong, read by someone deciding what to change about
 * their own product.
 *
 * THE REAL FIX IS ONE COLUMN, AND IT IS NOT THIS WAVE'S. Persist the detector
 * (or the role, per count) on the finding row and this whole map deletes. The
 * day a third detector lands with an arity of one or two, every finding it
 * produces is withheld with the log line below — loudly, not silently — and
 * that is the moment to do it.
 */
const ROLES_BY_ARITY: ReadonlyMap<number, readonly CountRole[] | null> = buildRolesByArity();

function buildRolesByArity(): ReadonlyMap<number, readonly CountRole[] | null> {
  const byArity = new Map<number, readonly CountRole[] | null>();

  for (const roles of Object.values(COUNT_ROLES) as readonly (readonly CountRole[])[]) {
    // A second detector at the same arity makes that arity AMBIGUOUS, and an
    // ambiguous arity resolves to nothing rather than to whichever row was
    // enumerated first.
    byArity.set(roles.length, byArity.has(roles.length) ? null : roles);
  }

  return byArity;
}

/** The same context derivation the tick itself uses (D7): from the row being
 * processed, through the one accepted schema, under the delivery actor. */
function contextFor(organization: SlackDeliveryOrganization): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.DELIVERY_TICK, organization);
}

/**
 * A persisted count, back through the ONE constructor.
 *
 * TWO PARSES, AND BOTH EARN THEIR PLACE. `MeasuredCountRow` types
 * `basis.setAside[].reason` as a bare `string` — jsonb holds every shape ever
 * written, so the repository's read schema deliberately does not promise the
 * closed union `measuredCount` requires. `measuredCountInputSchema` is that
 * narrowing, done at this boundary; `measuredCount` then asserts the arithmetic
 * (`kept + Σ setAside === totalInWindow`, `denominator === kept`, numerator ≤
 * denominator) and stamps the brand, which no round-trip through jsonb can
 * recreate.
 *
 * Both THROW — deliberately. `measuredCount` is where "35 of 28 sessions" stops
 * being renderable, and this module's caller turns the throw into a withheld
 * finding rather than into a post (D5, and the scheduler's own fail direction).
 */
function toMeasuredCount(row: MeasuredCountRow): MeasuredCount {
  return measuredCount(
    measuredCountInputSchema.parse({
      numerator: row.numerator,
      denominator: row.denominator,
      unit: row.unit,
      timeframe: { start: row.timeframe.start, end: row.timeframe.end },
      basis: {
        totalInWindow: row.basis.totalInWindow,
        kept: row.basis.kept,
        setAside: row.basis.setAside.map((aside) => ({
          reason: aside.reason,
          count: aside.count,
          label: aside.label,
        })),
      },
    }),
  );
}

/**
 * The renderer's input for one persisted finding, or `null` if this finding
 * cannot be rendered into an honest message.
 *
 * `null` is ALWAYS a withheld finding and never a silent success: every branch
 * here logs its own reason at the call site. The finding row itself is
 * untouched — a finding is a true, evidenced artifact and a rendering fault is
 * a fact about our renderer, not about the customer's product.
 *
 * THE EXPLANATION'S TWO ARMS ARE THE PERSISTED `summary_source`, unchanged.
 * `model_rendered` carries the model's own words; every `floor_*` member is an
 * ABSENCE STATEMENT ABOUT THE EXPLANATION and the renderer supplies the
 * sentence for it from the shipped table. The numbers are identical either way
 * (SAC-6), which is why the floor arm carries no text and must not be given
 * any here.
 */
function messageInputFor(finding: FindingRecord): DeliverMessageInput | null {
  const roles = ROLES_BY_ARITY.get(finding.counts.length) ?? null;
  if (roles === null) {
    return null;
  }

  const observations = finding.counts.map((row, index) => {
    // `roles.length === finding.counts.length` is what the map is keyed on, so
    // this index is in range; the `?? ` is the type system's price for reading
    // a tuple by a number, not a real branch.
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

  // The model arm needs BOTH strings; the renderer's schema refuses an empty
  // one, and a `model_rendered` row with nothing written on it is a
  // contradiction we withhold rather than paper over with a floor sentence
  // that would assert something this row does not establish.
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

/**
 * The magnitude the scheduler ranks this candidate on.
 *
 * THE LAST COUNT, on both detectors, and that is a property of `COUNT_ROLES`
 * rather than a coincidence: `funnel_dropoff` emits `[reached_surface,
 * left_without_continuing]` and `error_event` emits `[affected_sessions]`, so
 * the last element is the SYMPTOM in both cases — the sessions something went
 * wrong for, never the sessions that merely arrived. Ranking on the arrival
 * count would sort every funnel finding by traffic instead of by damage.
 */
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

/**
 * A persisted finding, down-shaped into the candidate the scheduler ranks and
 * the message the renderer will build — or `null`, meaning WITHHELD AND LOGGED.
 *
 * The message travels WITH the candidate (`DeliverableFinding`), which is the
 * D11 shape `delivery-tick.ts` states: there is no second read between deciding
 * and rendering that could come back empty and strand a decision.
 */
function deliverableFor(finding: FindingRecord, logger: DeliveryLogger): DeliverableFinding | null {
  // The branded identity, through its one constructor. A row whose signature is
  // not a 64-char lowercase hex digest is a row written by something that is
  // not this pipeline, and the delivery ledger keys on this value — so it is
  // checked before it is branded rather than cast into place.
  if (!isSignatureHex(finding.signature)) {
    logger.error(
      `delivery lane source: finding ${finding.id} carries a signature that is not a digest, so it was held back`,
    );
    return null;
  }
  const signature: SignatureHex = signatureHex(finding.signature);

  const confidence = confidenceBasisSchema.safeParse(finding.confidenceBasis);
  if (!confidence.success) {
    // D5: `confidence_basis` is a text column, so prod holds every shape ever
    // written. An unreadable one is refused here rather than sorted as `NaN` by
    // the scheduler's comparator.
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
    // `measuredCount` refusing a contradictory row. Logged with the finding id
    // and the constructor's own message — which names arities and shapes, never
    // a numerator or a denominator, because those are facts about somebody
    // else's product.
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

  return { findingId: finding.id, confidenceBasis, sampleSize, signature, message };
}

/** Whether this delivery row means the finding has ALREADY BEEN SENT or is
 * being sent right now. A `failed` row is deliberately NOT one of those: the
 * ledger's claim re-claims a failed row on purpose, so the finding stays
 * deliverable and a corrected message goes out on a later tick (D8). */
function isSpokenFor(delivery: DeliveryRecord | null): boolean {
  return delivery !== null && delivery.status !== "failed";
}

/** Whether this delivery landed inside the window the weekly ceiling is
 * measured over. `postedAt` and NOT `claimedAt`: the budget counts what reached
 * the customer, and a claim that never posted is not a thing anybody read. */
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

/**
 * The production `DeliveryLaneSource`: every organization with an active
 * delivery channel, each of its projects, that project's undelivered findings
 * composed into candidates, and the count of what has already gone out this
 * week.
 *
 * ONE LANE PER PROJECT, not per organization. `DeliveryLane` carries a
 * `projectId` and the tick's whole backpressure question — `listPendingForProject`,
 * "is one already open?" — is asked per project. An organization with two
 * products is two funnels with two independent conversations, and collapsing
 * them would let one product's open finding silence the other's forever.
 */
export function createDeliveryLaneSource(deps: DeliveryLaneSourceDeps): DeliveryLaneSource {
  /**
   * ONE PROJECT'S LANE.
   *
   * `null` means THIS PROJECT'S TURN FAILED (D8) — an unreadable findings read,
   * a repository that stopped answering. It never means "nothing to send": that
   * is a lane with empty `candidates`, which the scheduler already names as
   * `no_findings_ready`, and collapsing the two would make a broken read
   * indistinguishable from a quiet product.
   *
   * THE PARAMETER TYPE IS THE AD-4 GUARD, not a comment about it. A
   * `DeliveryTarget<SlackDeliveryOrganization>` is an organization whose channel
   * `isDeliveryTarget` has already proven to be a string, so both channel reads
   * below are plain string reads and neither needs a null check of its own. A
   * future caller that has not consulted the guard cannot reach this function at
   * all — the narrowing is the argument.
   */
  async function laneFor(
    organization: DeliveryTarget<SlackDeliveryOrganization>,
    ctx: TenantContext,
    projectId: string,
    at: Date,
  ): Promise<DeliveryLane | null> {
    const windowStart = new Date(at.getTime() - DELIVERY_WEEK_MS);

    try {
      const findings = createFindingsRepo(deps.db, ctx);
      const deliveries = createDeliveriesRepo(deps.db, ctx);

      // Org- AND project-scoped, newest first. The bound is stated on
      // `FINDINGS_CONSIDERED_PER_LANE`; its one real cost is that a delivery of
      // a finding older than this page is not seen by the weekly count below,
      // which can only ever UNDER-count and therefore only ever err toward
      // sending — so it is the cheap half of the trade rather than the free
      // one, and it is the reason the count wants a home in `packages/db` as a
      // real aggregate. Flagged, not hidden.
      const recent = await findings.listForProject(projectId, {
        limit: FINDINGS_CONSIDERED_PER_LANE,
      });

      const candidates: DeliverableFinding[] = [];
      let deliveredThisWeek = 0;

      for (const finding of recent) {
        // Keyed on `(finding, channel)` under this organization's own filter —
        // the SAME tuple the claim conflicts on, so "have we sent this?" is
        // asked of exactly the row the tick will write (D2 stamp/filter
        // symmetry).
        //
        // AND THIS IS WHY `findFor` STILL TAKES A `string` (AD-4, row 7). A null
        // channel would not error here; it would match ZERO ROWS, so
        // `isSpokenFor` returns false, the tick concludes the finding was never
        // sent, and the customer receives it again every week — a dedup key
        // forked by a null, with nothing in a log. The channel arrives already
        // proven by this function's parameter type, so the failure is a compile
        // error at the caller rather than silence here.
        const delivery = await deliveries.findFor(finding.id, organization.channelId);

        if (wasPostedInWindow(delivery, windowStart, at)) {
          deliveredThisWeek += 1;
        }

        if (isSpokenFor(delivery)) {
          continue;
        }

        const deliverable = deliverableFor(finding, deps.logger);
        if (deliverable !== null) {
          candidates.push(deliverable);
        }
      }

      return {
        organizationId: organization.organizationId,
        organizationName: organization.organizationName,
        projectId,
        // FR-O13: OFF THE CONNECTION ROW. Not a parameter, not a payload, not a
        // default — the one delivery address this organization stored.
        channelId: organization.channelId,
        deliveredThisWeek,
        candidates,
      };
    } catch (error) {
      deps.logger.error(
        `delivery lane source: skipping project ${projectId} (org ${organization.organizationId}) ` +
          `this tick: ${describeError(error)}`,
      );
      return null;
    }
  }

  return {
    async listDueLanes(at: Date): Promise<readonly DeliveryLane[]> {
      // THE POPULATION, and the only unscoped read in this file. It answers
      // "who has a channel connected", one row per organization, each carrying
      // its own channel — never a credential, and never another organization's
      // anything.
      const organizations = await listOrgsWithActiveSlackConnection(deps.db);
      const lanes: DeliveryLane[] = [];

      for (const organization of organizations) {
        // AD-4, AND THE ONLY PLACE THIS TICK ANSWERS THE NULL CHANNEL. The
        // population is "who has an active Slack installation", which since
        // migration 0010 includes an organization mid-OAuth: a real bot token
        // and no address yet. A lane is the thing that gets posted, so the
        // narrowing happens HERE, before one is built — `DeliveryLane.channelId`
        // stays `string` and "refuse to post" is a compile-time funnel rather
        // than a runtime check somebody forgets at the next call site.
        //
        // `info`, NEVER `error`. A founder between consent and channel choice is
        // mid-setup, not broken, and a tick that logged this as a fault would
        // teach an operator to ignore the line that also reports a real one. The
        // line exists because "this customer received nothing" must be
        // answerable from the log rather than inferred from silence.
        if (!isDeliveryTarget(organization)) {
          deps.logger.info(
            `delivery lane source: organization ${organization.organizationId} has a Slack ` +
              `workspace attached and no channel chosen, so there is nowhere to deliver`,
          );
          continue;
        }

        // The context build and the project list are BOTH inside the isolation,
        // and the context is built ONCE per organization. `systemContextFor`
        // parses through `tenantContextSchema` and can refuse — an organization
        // whose name went missing, a row shape nobody expected — so building it
        // outside this try would let one bad row take the whole tick down and
        // cost every other customer their delivery (D8). One build also means
        // every repository below is scoped by the same value rather than by two
        // that could, in principle, differ.
        let ctx: TenantContext;
        let projectIds: readonly string[];
        try {
          ctx = contextFor(organization);
          const projects = await createProjectsRepo(deps.db, ctx).list();
          projectIds = projects.map((project) => project.id);
        } catch (error) {
          deps.logger.error(
            `delivery lane source: skipping org ${organization.organizationId} this tick: ` +
              `${describeError(error)}`,
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
