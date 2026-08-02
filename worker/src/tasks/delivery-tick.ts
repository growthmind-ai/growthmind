/**
 * The delivery lane's composition root: decide, render, scan, claim, post, terminal
 * state, once per due project. The residual PII scan runs over the exact text that is
 * posted, and every path out of a successful claim records `posted` or `failed`: a
 * row left `pending` jams the project's lane silently, forever.
 *
 * Design rationale: docs/decisions/0003-delivery-tick-lanes.md
 */
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

/**
 * The one-home sentence for "we could not get this into Slack", narrowed once.
 *
 * `DELIVERY_STATUS_MESSAGES` is `Record<DeliveryStatus, string | null>` because two of
 * its three states deliberately carry `null`. A posted finding IS its own evidence, and
 * inventing a sentence for it would be a claim nothing established. `failed` is the
 * opposite: it is precisely the state that needs words, because it is the only thing
 * standing between a founder and what looks like silence.
 *
 * Resolved here rather than at each call site, and resolved by throwing rather than by
 * falling back to a locally-authored string: a second copy of a customer-facing
 * sentence is how the one-home rule dies, and an empty `failure_reason` is a blank a
 * founder stares at. If that sentence ever disappears from `@growthmind/shared`, this
 * module fails to import, which every test in this package, and the worker's own boot,
 * notices immediately.
 */
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

/** The logger surface this handler needs. The subset Graphile Worker's `helpers.logger`
 * already satisfies, so the thin closure in ../index.ts passes it straight through and a
 * test passes a recording fake. */
export interface DeliveryLogger {
  info(message: string): void;
  error(message: string): void;
}

/**
 * This lane's scheduled actor, re-exported for the tests that assert who wrote a row.
 *
 * The value and the `TenantContext` built from it live in `@growthmind/db/system`, one
 * home for every background writer's identity, behind the boundary that keeps `apps/`
 * from minting a system scope at all.
 */
export const DELIVERY_ACTOR_ID = SYSTEM_ACTOR.DELIVERY_TICK;

/** The renderer's deliver arm, named, `Extract<…>` at four call sites reads as noise,
 * and this is the only shape a candidate can be rendered from. */
export type DeliverMessageInput = Extract<SlackMessageInput, { decision: "deliver" }>;

/**
 * A finding this project could send today: what the scheduler ranks on
 * (`DeliveryCandidate`), plus the two things posting it needs. The identity the
 * delivery row is keyed by, and the message input.
 *
 * The message travels with the candidate rather than being fetched after the choice, so
 * there is no second read between deciding and rendering that could come back empty and
 * strand a decision (the value the consumer needs is produced by the same read that
 * produced the candidate).
 */
export type DeliverableFinding = DeliveryCandidate & {
  readonly signature: SignatureHex;
  readonly message: DeliverMessageInput;
};

/**
 * One project's delivery lane, as the source read it.
 *
 * `channelId` is the org's one delivery address at MVP. Resolved by the source from the
 * stored connection row, never from a payload.
 *
 * `openFindingIds` is deliberately absent: this handler reads it itself from
 * `listPendingForProject`, because the table the scheduler's "is one already open?"
 * question is answered from must be the same table the writes below land on. A lane
 * source computing that number separately is a stamp/filter asymmetry waiting to
 * happen.
 */
export type DeliveryLane = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly projectId: string;
  /** The delivery address, a Slack channel id today. */
  readonly channelId: string;
  /** Counted over the week containing this tick. The window `DELIVERY_BUDGET_PER_WEEK`
   * is a ceiling on. */
  readonly deliveredThisWeek: number;
  readonly candidates: readonly DeliverableFinding[];
};

/**
 * Where lanes come from. A port rather than a repository call, and the gap it was
 * holding open is now closed.
 *
 * This interface shipped with no producer, because the delivering side of the lane
 * needed a `findings` table and a `slack_connections` table that did not exist yet:
 * what shipped then was the scheduler, the renderer, the scanner, the ledger and the
 * poster port, and nothing that could build a lane. Naming the read as a port rather
 * than inlining a query is what kept that gap visible and one-line-fillable.
 *
 * `../delivery-lane-source.ts` is that one line, landed. Both tables exist,
 * `createDeliveryLaneSource` implements this interface against them, and nothing in
 * this file changed for it, which is what the port was for. From here on, an empty lane
 * list means "nobody has connected a channel", never "no producer was written".
 */
export interface DeliveryLaneSource {
  /** Every project due a delivery decision on this tick. An empty list is an ordinary
   * answer. A deployment with no project connected is a supported deployment, not a
   * fault. */
  listDueLanes(now: Date): Promise<readonly DeliveryLane[]>;
}

/**
 * The ledger, org-scoped at construction. Injected as a factory over the shipped
 * `DeliveriesRepo` interface rather than as a `ScopedDb`, so the handler is tested
 * against the ledger's contract with a fake carrying real state, and the fake is
 * compile-checked against the same interface production uses, so it cannot drift into
 * agreeing with a repository that no longer exists. The one call to
 * `createDeliveriesRepo` lives in ../index.ts, beside the pool it needs.
 */
export type DeliveriesRepoFor = (ctx: TenantContext) => DeliveriesRepo;

/**
 * THE POSTER, RESOLVED PER LANE FROM THE LANE'S OWN TENANT CONTEXT (AD-13,
 * correction C-C).
 *
 * `createSlackDeliveryPoster` binds ONE workspace's bearer token AT
 * CONSTRUCTION, and `PostRequest` carries `channelId`, `blocks`, `fallbackText`
 * and NO ORGANIZATION — so a single poster instance can serve exactly one
 * organization's token while this tick iterates lanes across every organization
 * on the installation. A `poster: DeliveryPoster` field was therefore a
 * single-tenant assumption hiding in a multi-tenant loop.
 *
 * THE REJECTED ALTERNATIVE — a dispatching poster mapping `channelId` → org —
 * is a D7 hazard BY CONSTRUCTION: it keys a CREDENTIAL LOOKUP on a value that
 * TRAVELS WITH THE MESSAGE. This resolver takes a `TenantContext` and nothing
 * else, so the credential can only be found by the organization the lane row
 * named. It is the same factory shape `deliveriesFor` above already uses, and
 * `findingsFor`/`runsFor`/`ledgerFor` use one file over.
 *
 * `null` is an ORDINARY ANSWER: this organization has no active delivery
 * channel — revoked between the lane read and the post, or never connected. The
 * lane is skipped and said out loud; it is not an error and it does not fail
 * the tick. Typed by the PORT (`@growthmind/shared`), never by a Slack factory:
 * this file must not learn the vendor's name, and ../index.ts is where a
 * concrete adapter is selected.
 */
export type DeliveryPosterFor = (ctx: TenantContext) => Promise<DeliveryPoster | null>;

export interface DeliveryTickDeps {
  lanes: DeliveryLaneSource;
  deliveriesFor: DeliveriesRepoFor;
  posterFor: DeliveryPosterFor;
  /** The only way this handler reads time. A fake clock in a test is therefore
   * total: nothing here reads `Date.now()` by any other route. */
  now: () => Date;
  logger: DeliveryLogger;
}

export interface DeliveryTickSummary {
  /** Lanes the source returned. */
  lanesConsidered: number;
  /** Findings Slack accepted. */
  posted: number;
  /** Deliveries that reached the terminal `failed` state, including the ones blocked
   * below. A finding we refused to post is a finding that did not go out, and hiding
   * that in a separate number would make this one read as healthier than the lane was. */
  failed: number;
  /** The subset of `failed` the residual PII gate refused. Counted separately because
   * "we held it back" and "Slack would not take it" are different facts about different
   * systems, and the first is this outcome's whole point. */
  blockedByPii: number;
  /** Lanes that decided `nothing_today`. Not a failure, and not a post. */
  nothingToday: number;
  /** Lanes where another worker already owned the post. Not a failure, the guarantee
   * working. */
  notClaimed: number;
  /** Lanes whose organization has no active delivery channel to resolve a
   * poster from. NOT counted as an error and NOT counted as a failure: on a
   * multi-org installation an organization that has not connected Slack (or
   * has revoked it) is a supported state, and putting it in `lanesErrored`
   * would make every such installation look permanently unhealthy while
   * burying the one lane that really did fail. */
  notConnected: number;
  /** Lanes that threw somewhere this handler could not attribute. Isolated: a
   * non-zero value here does not mean the tick failed. */
  lanesErrored: number;
}

/** What one lane's turn produced. A value, never an exception. An isolated failure that
 * travels as a throw is a failure that can abort a sibling. */
type LaneOutcome =
  | "posted"
  | "failed"
  | "blocked_by_pii"
  | "nothing_today"
  | "not_claimed"
  | "not_connected"
  | "unresolvable";

/**
 * Either the exact request to post, or the plain-English reason we will not.
 *
 * Both arms exist so the refusal is a value the caller must handle, not an early return
 * somebody can forget: `request` is only reachable through `ok: true`, and
 * `poster.post` is only called there.
 */
type PreparedPost =
  | { readonly ok: true; readonly request: PostRequest }
  | { readonly ok: false; readonly reason: string; readonly outcome: LaneOutcome };

/**
 * The string the PII gate scans. Derived from the request that will be posted, so the
 * gate and the post can never see different text.
 *
 * It covers the fallback text (the notification preview and what a screen reader reads)
 * and every block, serialised whole. Serialising rather than reaching for a `text`
 * field is deliberate: `PostRequest.blocks` is `readonly unknown[]`, so a block shape
 * this file does not know about would otherwise contribute nothing to the scan. Prose
 * that reached Slack without ever being cleared. JSON covers every string in every
 * block regardless of shape.
 *
 * Fail direction: closed. `null` means "this request cannot be cleared" (a block graph
 * JSON cannot represent), and the caller treats that as a refusal rather than as clean
 * text. A gate that cannot read its input must not wave it through.
 */
export function textPostedFor(request: PostRequest): string | null {
  try {
    return `${request.fallbackText}\n${JSON.stringify(request.blocks)}`;
  } catch {
    return null;
  }
}

/**
 * Render the chosen finding and clear it. The two steps that must both succeed before
 * anything is posted, in the one order that makes the gate meaningful.
 *
 * `renderSlackMessage` refuses malformed input by throwing (its own header says so, and
 * says the delivery task is what turns that refusal into a state the founder can see).
 * So it is caught here and converted into a terminal `failed` with the one-home
 * sentence, never into silence, and never into a partial message posted anyway.
 */
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
      // The renderer's own plaintext, not a re-derivation: two plaintexts of one
      // message are two things that drift, and this one is what its legibility budget
      // was measured on.
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
    // The kind and nothing else. No offset, no excerpt, no count. The log line and the
    // customer-facing reason both name the shape we saw, because quoting the match
    // would copy the personal data into the very places we just refused to send it.
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

/**
 * Builds the `TenantContext` this lane's writes run as, from the lane row itself, never
 * from a payload, never from a caller-supplied id.
 *
 * The parse and the actor both live in `@growthmind/db/system`; this names which actor
 * and nothing else.
 */
function tenantContextFor(lane: DeliveryLane): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.DELIVERY_TICK, lane);
}

/**
 * Records the terminal `failed` state. Never throws: this is the last thing standing
 * between a post that did not happen and a row stuck `pending`, so a fault here is
 * logged loudly rather than propagated into the lane loop, which would leave the row
 * exactly as stuck and lose the log line.
 *
 * A `null` return means nothing was updated. The row is already `posted` (a late
 * failure signal, which `markFailed` deliberately refuses so the finding is not
 * re-posted) or it is not this org's. Both are worth a line; neither is something a
 * caller can act on.
 */
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

/**
 * One project's turn.
 *
 * Returns an outcome on every path; the only throws that escape are faults in the
 * machinery around a delivery (the context build, the repository factory, the lane
 * read), which the caller isolates.
 */
async function runLane(
  deps: DeliveryTickDeps,
  lane: DeliveryLane,
  tickAt: Date,
): Promise<LaneOutcome> {
  const ctx = tenantContextFor(lane);

  // THE POSTER IS RESOLVED FIRST, ONCE PER LANE, FROM THIS LANE'S OWN CONTEXT
  // (AD-13) — before the ledger is read, before anything is decided, and long
  // before anything is claimed. Resolving late would mean discovering a revoked
  // channel while holding a `pending` row for a message that can never be sent,
  // which is the stuck state D8 exists to prevent; resolving here means a lane
  // with nowhere to post simply does no work at all.
  //
  // The context is the WHOLE input. There is no channel id and no message in
  // it, so a credential can only ever be found by the organization the lane row
  // named (D7).
  const poster = await deps.posterFor(ctx);

  if (poster === null) {
    // GRACEFUL ABSENCE, PER ORGANIZATION — distinct from the installation-wide
    // absence ../index.ts logs. Said out loud rather than skipped silently: a
    // silent skip is indistinguishable from a lane that ran and found nothing,
    // which is the one distinction this vocabulary exists to keep. The
    // organization is named so a reader of a multi-org installation's logs can
    // tell WHICH customer is unconnected.
    deps.logger.info(
      `delivery tick: org ${lane.organizationId} has no delivery channel connected, so project ` +
        `${lane.projectId} was left alone this tick`,
    );
    return "not_connected";
  }

  const deliveries = deps.deliveriesFor(ctx);

  // The open set is a persisted fact, read under this org's filter, never a transient
  // signal and never a number the lane source computed.
  //
  // TODO: today "open" means a delivery still `pending`. The `findings` table
  // now exists and this read COULD become "findings awaiting an answer", at
  // which point a posted-but-unanswered finding would hold the lane the way
  // FR-6 describes — but the customer's ANSWER has no persistence yet, so there
  // is still nothing to read "awaiting" from. Until that lands the backpressure
  // is real but shorter-lived than the product decision intends.
  const pending = await deliveries.listPendingForProject(lane.projectId);

  const state: DeliveryLaneState = {
    openFindingIds: pending.map((row) => row.findingId),
    deliveredThisWeek: lane.deliveredThisWeek,
    candidates: lane.candidates,
  };

  const decision = decideDelivery(state, tickAt);

  if (decision.decision === "nothing_today") {
    // Logged and counted; not posted, and no row written. See the header for why, and
    // for what changes.
    deps.logger.info(
      `delivery tick: project ${lane.projectId} has nothing to send today — ${decision.reason}`,
    );
    return "nothing_today";
  }

  const chosen = lane.candidates.find(
    (candidate) => candidate.findingId === decision.finding.findingId,
  );
  if (!chosen) {
    // Unreachable by construction, `decideDelivery` chooses from the array it was
    // handed. Handled anyway, and handled by doing nothing: with no renderable finding
    // there is nothing to claim, nothing to post, and no row to strand. A crash here
    // would abort a sibling project's delivery.
    deps.logger.error(
      `delivery tick: project ${lane.projectId} chose finding ${decision.finding.findingId}, which is not in its own candidate list`,
    );
    return "unresolvable";
  }

  // Render and scan before the claim. Both are pure and cost nothing to redo, so doing
  // them first means a message we will refuse never becomes a `pending` row we then
  // have to unwind.
  const prepared = prepare(chosen, lane, deps.logger);

  // The claim is the lock. One statement against the unique index decides who owns this
  // post; there is no "does a delivery already exist?" read before it, so two
  // overlapping ticks cannot both conclude they may post.
  const claim = await deliveries.claimForPost({
    projectId: lane.projectId,
    findingId: chosen.findingId,
    signature: chosen.signature,
    channelId: lane.channelId,
    claimedAt: tickAt,
  });

  if (!claim.claimed) {
    // Someone else owns it. Another tick, or a retry of a job that already got as far
    // as posting. Do nothing. Posting here is the double-post the deliveries table
    // exists to prevent, and writing a terminal state here would stamp our outcome onto
    // their row.
    deps.logger.info(
      `delivery tick: finding ${chosen.findingId} is already being delivered by another run, so this tick left it alone`,
    );
    return "not_claimed";
  }

  if (!prepared.ok) {
    // We now own a `pending` row for a message we will not send, so the terminal write
    // is mandatory. The row becomes `failed`, which is re-claimable. The finding stays
    // deliverable and a corrected message goes out on a later tick.
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
    // The port is contracted never to throw. If one does anyway, the row still reaches
    // a terminal state. A contract violation must not become a stuck `pending` that
    // jams this project's lane forever.
    //
    // The error's own text never reaches the row: a thrown error can carry vendor
    // detail, ids, and stack text, and `failure_reason` is customer-facing. The log
    // gets the detail (logs are ours); the row gets the one-home sentence.
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
    // THIS LANE'S OWN SENTENCE, COMPOSED FROM THE CODE. `failure_reason` is
    // customer-facing, and which of the four mechanisms fired is exactly the distinction
    // worth keeping — "the channel is gone" is far more actionable than a generic
    // sentence, and this is the one place it survives.
    //
    // Two deliberate choices in one call:
    //
    // THE CODE, NOT `result.message`. The port contracts `message` to be plain English
    // with no vendor text in it (`packages/shared/src/delivery/poster.ts`), an obligation
    // the adapter owns and pins with its own test — but reading the closed union instead
    // of trusting it is free, and it is the same belt-and-braces the first-run routes
    // apply at their own boundary. A Slack response body has no route into this column.
    //
    // AND IT CARRIES THE LANE'S NEXT ACTION. `POST_FAILURE_MESSAGES` states what
    // happened and stops, because it is read by first-run too and a next action written
    // for one surface is wrong on the other. `deliveryFailureSentence` appends THIS
    // lane's — the one that is true when nobody is looking at a setup screen.
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
    // The message is already in the channel. There is no undo and no retry that would
    // not post it twice, so this is logged loudly and the row is left as it is. This is
    // the one path that can leave a `pending` row behind, and it has to be findable.
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
      // Counted in both: it is a failed delivery, and it is the gate firing.
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

/**
 * Decide, render, clear, claim, post. Once per due project.
 *
 * A tick with no due lanes is a clean no-op: no crash, no error state, and nothing
 * recorded. A deployment with no project connected, or no analysis yet run, is a
 * supported deployment (the self-host graceful-absence promise), and recording
 * something here would make "nothing is attached" indistinguishable from "we looked and
 * there was nothing to send". The one distinction this lane's whole vocabulary exists
 * to keep.
 *
 * The lane read is deliberately outside the isolation: if the source itself fails there
 * are no lanes to isolate from each other, and letting it throw is what makes Graphile
 * Worker retry the tick rather than record a healthy-looking run over a read that never
 * happened.
 */
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
      // Per-lane isolation. One project's fault cannot cost every other project its
      // delivery. The loop continues, and the next lane posts.
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
