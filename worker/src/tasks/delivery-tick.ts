/**
 * THE DELIVERY LANE'S COMPOSITION ROOT (O-007 FR-16, FR-17, FR-22).
 *
 * A plain exported async function with no queue types in its signature, so it
 * is unit-testable without a queue and the whole lane can be driven end to end
 * through the REAL consumer entry point with fakes (D11). Registration lives in
 * ../index.ts, the only queue-aware file — the same split
 * ./session-source-poll.ts uses, and for the same reason.
 *
 * Nothing here decides anything. Every judgement was made by a pure function
 * that already shipped, and this file's whole job is to run them in the one
 * order that cannot leak, cannot double-post, and cannot jam:
 *
 *   decide (`decideDelivery`) → render (`renderSlackMessage`) →
 *   SCAN (`scanResidualPii`) → claim (`claimForPost`) → post → terminal state
 *
 * ── THE SCAN RUNS OVER THE TEXT THAT WILL ACTUALLY BE SENT ──────────────────
 * The outcome's definition of done is "the residual PII scanner passes over
 * generated text before any push or post", and a gate that scans a DIFFERENT
 * string from the one posted is a gate that does nothing — the D11 shape where
 * a value is computed and then dropped on the floor. So the `PostRequest` is
 * built FIRST, `textPostedFor` derives the scanned string from that very
 * object, and the object handed to the poster is the same reference. Scanning
 * the model's raw input instead would clear text nobody sends and post text
 * nobody cleared.
 *
 * Structurally, not by discipline: `poster.post` is reachable on exactly one
 * branch — the one where `prepared.ok` is true — and `prepare` is the only
 * producer of that value. A refusal cannot be routed around without deleting
 * the branch.
 *
 * A dirty scan does NOT post, records the delivery `failed` with a sentence
 * from `@growthmind/shared`'s one home, and NEVER quotes the offending text:
 * echoing the match would copy the personal data into the row, the logs, and
 * every alert built on them — relocating the leak instead of closing it. The
 * finding is untouched and stays deliverable (a `failed` row is re-claimable),
 * so a fixed summary goes out on a later tick.
 *
 * ── CLAIM BEFORE POST, ALWAYS (D4) ──────────────────────────────────────────
 * `claimForPost` is one atomic statement against the unique index; a
 * `{claimed: false}` means another worker (or a Graphile Worker retry of a job
 * that already got as far as posting) owns this post. On that answer this
 * handler does NOTHING and returns — no post, no terminal write, no log-level
 * error. It is the ordinary outcome of two ticks overlapping, not a fault.
 *
 * ── EVERY EXIT PATH IS TERMINAL (D8) ────────────────────────────────────────
 * A claimed row starts `pending`, and a row left `pending` shows up in
 * `listPendingForProject` forever — which makes the scheduler answer
 * `one_already_open` on every future tick and jams the lane silently, with no
 * error anywhere. So every path out of a successful claim records `posted` or
 * `failed`: the poster's `ok: false` arm, an unexpected THROW from the poster
 * (a port contracted never to throw is still a port somebody can break), a
 * render refusal, and the PII refusal. The only path that can leave a `pending`
 * row is a terminal write that itself fails, and that one is logged loudly.
 *
 * ── PER-LANE ISOLATION (D8) ─────────────────────────────────────────────────
 * One project's failure cannot abort the batch; a sibling project still
 * delivers. The per-lane try/catch is belt-and-braces on top of the branch-level
 * handling below, so a fault in the paths AROUND a delivery (the repository
 * construction, the context build) still cannot take the tick down.
 *
 * ── NOTHING-TODAY IS DECIDED, LOGGED, AND NOT POSTED ────────────────────────
 * The decision, and why, because the shape of the data forces it:
 *
 * `deliveries` deliberately has NO row shape for a nothing-today. It has no
 * `finding_id`, and giving it one would mean making that column nullable —
 * voiding the `(organization_id, finding_id, channel_id)` unique index that IS
 * the idempotency guard this whole lane rests on (see the header of
 * `packages/db/src/schema/deliveries.ts`). Nothing else in this branch's
 * history persists a scheduler day-state either.
 *
 * So there is no key on which "have we already said this today?" could be
 * asked. A nothing-today post would therefore be an UNKEYED post from a cron
 * tick: it would repeat on every tick, forever, and the customer's channel
 * would fill with us saying nothing — the exact D3/D4 spam this table's index
 * exists to make impossible for findings. Between "say nothing this tick" and
 * "possibly say nothing dozens of times a day", only one of those can be
 * un-sent. It is not posted.
 *
 * That also matches the product ruling this sprint was written against
 * (`tasks/delivery-slack-pii/prd.md`, Constraint 2 / OQ-1: "nothing-today never
 * posts to Slack at MVP — a daily 'nothing today' post erodes the channel's
 * signal"). The tick logs the reason, counts it in the summary, and creates NO
 * `deliveries` row.
 *
 * TODO(O-008): the honest version of this needs persistence that does not exist
 * yet — a scheduler day-state row keyed `(project, day)`. When O-008 lands its
 * first-run surface, that row is what makes a nothing-today idempotent, and
 * this branch becomes a claim-then-post exactly like the deliver arm, with the
 * day key playing the part the unique index plays here. Until then the reason
 * is a log line and a counter, not a message, and `nothing_today` is READ from
 * the app rather than pushed at anybody.
 *
 * ── TENANT SCOPE COMES FROM THE LANE ROW ────────────────────────────────────
 * There is no payload — the task is cron-triggered — so there is nothing a
 * caller could supply an organization id through even in principle. The context
 * is built from the lane the source read, parsed through the same
 * `tenantContextSchema` a request-derived context is, and every repository is
 * constructed org-scoped from it (D7).
 */
import type { DeliveryCandidate, DeliveryLaneState, SlackMessageInput } from "@growthmind/core";
import { decideDelivery, renderSlackMessage, scanResidualPii } from "@growthmind/core";
import type { DeliveriesRepo, SignatureHex } from "@growthmind/db";
import type { DeliveryPoster, PostRequest, PostResult, TenantContext } from "@growthmind/shared";
import {
  DELIVERY_STATUS_MESSAGES,
  DELIVERY_VOCABULARY,
  RESIDUAL_PII_KIND_MESSAGES,
  tenantContextSchema,
} from "@growthmind/shared";

/**
 * The one-home sentence for "we could not get this into Slack", narrowed once.
 *
 * `DELIVERY_STATUS_MESSAGES` is `Record<DeliveryStatus, string | null>` because
 * two of its three states deliberately carry `null` — a posted finding IS its
 * own evidence, and inventing a sentence for it would be a claim nothing
 * established. `failed` is the opposite: it is precisely the state that needs
 * words, because it is the only thing standing between a founder and what looks
 * like silence.
 *
 * Resolved here rather than at each call site, and resolved by THROWING rather
 * than by falling back to a locally-authored string: a second copy of a
 * customer-facing sentence is how the one-home rule dies, and an empty
 * `failure_reason` is a blank a founder stares at. If that sentence ever
 * disappears from `@growthmind/shared`, this module fails to import — which
 * every test in this package, and the worker's own boot, notices immediately.
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

/** The logger surface this handler needs — the subset Graphile Worker's
 * `helpers.logger` already satisfies, so the thin closure in ../index.ts passes
 * it straight through and a test passes a recording fake. */
export interface DeliveryLogger {
  info(message: string): void;
  error(message: string): void;
}

/**
 * A NAMESPACED SENTINEL, not a fake user id — the same device
 * `packages/db/src/system/system-context.ts` uses for the poll. It cannot
 * collide with a Better Auth user id, and it says who acted in any log line or
 * future audit row without anyone having to look it up.
 */
export const DELIVERY_ACTOR_ID = "system:delivery-tick";

/** The role stamped on a system context, so a future audit surface can tell a
 * scheduled write from a human one without parsing the actor id. */
export const DELIVERY_ACTOR_ROLE = "system";

/** The renderer's deliver arm, named — `Extract<…>` at four call sites reads as
 * noise, and this is the only shape a candidate can be rendered from. */
export type DeliverMessageInput = Extract<SlackMessageInput, { decision: "deliver" }>;

/**
 * A finding this project could send today: what the scheduler ranks on
 * (`DeliveryCandidate`), plus the two things posting it needs — the identity the
 * delivery row is keyed by, and the message input.
 *
 * The message travels WITH the candidate rather than being fetched after the
 * choice, so there is no second read between deciding and rendering that could
 * come back empty and strand a decision (D11: the value the consumer needs is
 * produced by the same read that produced the candidate).
 */
export type DeliverableFinding = DeliveryCandidate & {
  readonly signature: SignatureHex;
  readonly message: DeliverMessageInput;
};

/**
 * One project's delivery lane, as the source read it.
 *
 * `channelId` is the org's ONE delivery address at MVP (FR-23) — resolved by
 * the source from the stored connection row, never from a payload.
 *
 * `openFindingIds` is deliberately ABSENT: this handler reads it itself from
 * `listPendingForProject`, because the table the scheduler's "is one already
 * open?" question is answered from must be the same table the writes below land
 * on. A lane source computing that number separately is a stamp/filter
 * asymmetry waiting to happen (D2).
 */
export type DeliveryLane = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly projectId: string;
  /** The delivery address — a Slack channel id today. */
  readonly channelId: string;
  /** Counted over the week containing this tick — the window
   * `DELIVERY_BUDGET_PER_WEEK` is a ceiling on. */
  readonly deliveredThisWeek: number;
  readonly candidates: readonly DeliverableFinding[];
};

/**
 * Where lanes come from. A PORT, not a repository call, because the delivering
 * side of this lane (a `findings` table and a `slack_connections` table) is not
 * in this branch's history yet — O-007 shipped the scheduler, the renderer, the
 * scanner, the ledger and the poster port, and the analysis lane that writes
 * findings is a later sprint's work.
 *
 * Naming the read as a port rather than inlining a query keeps that gap VISIBLE
 * and one-line-fillable: the day those tables land, the implementation is a
 * repository behind this interface and nothing in this file changes.
 */
export interface DeliveryLaneSource {
  /** Every project due a delivery decision on this tick. An empty list is an
   * ordinary answer — a deployment with no project connected is a supported
   * deployment, not a fault. */
  listDueLanes(now: Date): Promise<readonly DeliveryLane[]>;
}

/**
 * The ledger, org-scoped at construction. Injected as a FACTORY over the
 * shipped `DeliveriesRepo` interface rather than as a `ScopedDb`, so the handler
 * is tested against the ledger's CONTRACT with a fake carrying real state — and
 * the fake is compile-checked against the same interface production uses, so it
 * cannot drift into agreeing with a repository that no longer exists. The one
 * call to `createDeliveriesRepo` lives in ../index.ts, beside the pool it needs.
 */
export type DeliveriesRepoFor = (ctx: TenantContext) => DeliveriesRepo;

export interface DeliveryTickDeps {
  lanes: DeliveryLaneSource;
  deliveriesFor: DeliveriesRepoFor;
  /** Typed by the PORT (`@growthmind/shared`), never by a Slack factory. This
   * file must not learn the vendor's name; ../index.ts is where a concrete
   * adapter is selected. */
  poster: DeliveryPoster;
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
  /** Deliveries that reached the terminal `failed` state — INCLUDING the ones
   * blocked below. A finding we refused to post is a finding that did not go
   * out, and hiding that in a separate number would make this one read as
   * healthier than the lane was. */
  failed: number;
  /** The subset of `failed` the residual PII gate refused. Counted separately
   * because "we held it back" and "Slack would not take it" are different facts
   * about different systems, and the first is this outcome's whole point. */
  blockedByPii: number;
  /** Lanes that decided `nothing_today`. Not a failure, and not a post. */
  nothingToday: number;
  /** Lanes where another worker already owned the post. Not a failure — the
   * D4 guarantee working. */
  notClaimed: number;
  /** Lanes that threw somewhere this handler could not attribute. Isolated: a
   * non-zero value here does not mean the tick failed. */
  lanesErrored: number;
}

/** What one lane's turn produced. A value, never an exception — an isolated
 * failure that travels as a throw is a failure that can abort a sibling (D8). */
type LaneOutcome =
  | "posted"
  | "failed"
  | "blocked_by_pii"
  | "nothing_today"
  | "not_claimed"
  | "unresolvable";

/**
 * Either the exact request to post, or the plain-English reason we will not.
 *
 * Both arms exist so the refusal is a VALUE the caller must handle, not an early
 * return somebody can forget: `request` is only reachable through `ok: true`,
 * and `poster.post` is only called there.
 */
type PreparedPost =
  | { readonly ok: true; readonly request: PostRequest }
  | { readonly ok: false; readonly reason: string; readonly outcome: LaneOutcome };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The string the PII gate scans — derived from the request that will be POSTED,
 * so the gate and the post can never see different text (D11).
 *
 * It covers the fallback text (the notification preview and what a screen reader
 * reads) AND every block, serialised whole. Serialising rather than reaching for
 * a `text` field is deliberate: `PostRequest.blocks` is `readonly unknown[]`, so
 * a block shape this file does not know about would otherwise contribute
 * NOTHING to the scan — prose that reached Slack without ever being cleared.
 * JSON covers every string in every block regardless of shape.
 *
 * FAIL DIRECTION: closed. `null` means "this request cannot be cleared" (a block
 * graph JSON cannot represent), and the caller treats that as a refusal rather
 * than as clean text. A gate that cannot read its input must not wave it
 * through.
 */
export function textPostedFor(request: PostRequest): string | null {
  try {
    return `${request.fallbackText}\n${JSON.stringify(request.blocks)}`;
  } catch {
    return null;
  }
}

/**
 * Render the chosen finding and clear it — the two steps that must both succeed
 * before anything is posted, in the one order that makes the gate meaningful.
 *
 * `renderSlackMessage` REFUSES malformed input by throwing (its own header says
 * so, and says the delivery task is what turns that refusal into a state the
 * founder can see). So it is caught here and converted into a terminal `failed`
 * with the one-home sentence — never into silence, and never into a partial
 * message posted anyway.
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
      // message are two things that drift, and this one is what its legibility
      // budget was measured on.
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
    // The KIND and nothing else. No offset, no excerpt, no count — the log line
    // and the customer-facing reason both name the shape we saw, because
    // quoting the match would copy the personal data into the very places we
    // just refused to send it.
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
 * Builds the `TenantContext` this lane's writes run as, from the lane row
 * itself. Parsed through the SAME schema a request-derived context is, rather
 * than returned as a bare literal: there is one accepted context shape, and the
 * scheduled path is held to it too.
 */
function tenantContextFor(lane: DeliveryLane): TenantContext {
  return tenantContextSchema.parse({
    userId: DELIVERY_ACTOR_ID,
    organizationId: lane.organizationId,
    organizationName: lane.organizationName,
    role: DELIVERY_ACTOR_ROLE,
  });
}

/**
 * Records the terminal `failed` state. Never throws: this is the last thing
 * standing between a post that did not happen and a row stuck `pending`, so a
 * fault here is logged loudly rather than propagated into the lane loop, which
 * would leave the row exactly as stuck AND lose the log line.
 *
 * A `null` return means nothing was updated — the row is already `posted` (a
 * late failure signal, which `markFailed` deliberately refuses so the finding is
 * not re-posted) or it is not this org's. Both are worth a line; neither is
 * something a caller can act on.
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
 * Returns an outcome on every path; the only throws that escape are faults in
 * the machinery around a delivery (the context build, the repository factory,
 * the lane read), which the caller isolates.
 */
async function runLane(
  deps: DeliveryTickDeps,
  lane: DeliveryLane,
  tickAt: Date,
): Promise<LaneOutcome> {
  const ctx = tenantContextFor(lane);
  const deliveries = deps.deliveriesFor(ctx);

  // The open set is a PERSISTED fact, read under this org's filter — never a
  // transient signal and never a number the lane source computed (D4/D2).
  //
  // TODO(O-008): today "open" means a delivery still `pending`, because a
  // finding awaiting the customer's answer has no table in this branch's
  // history. When the analysis lane lands `findings`, this read becomes
  // "findings awaiting an answer" and a posted-but-unanswered finding starts
  // holding the lane the way FR-6 describes. Until then the backpressure is
  // real but shorter-lived than the product decision intends.
  const pending = await deliveries.listPendingForProject(lane.projectId);

  const state: DeliveryLaneState = {
    openFindingIds: pending.map((row) => row.findingId),
    deliveredThisWeek: lane.deliveredThisWeek,
    candidates: lane.candidates,
  };

  const decision = decideDelivery(state, tickAt);

  if (decision.decision === "nothing_today") {
    // Logged and counted; NOT posted, and no row written. See the header for
    // why, and for what O-008 changes.
    deps.logger.info(
      `delivery tick: project ${lane.projectId} has nothing to send today — ${decision.reason}`,
    );
    return "nothing_today";
  }

  const chosen = lane.candidates.find(
    (candidate) => candidate.findingId === decision.finding.findingId,
  );
  if (!chosen) {
    // Unreachable by construction — `decideDelivery` chooses from the array it
    // was handed. Handled anyway, and handled by doing NOTHING: with no
    // renderable finding there is nothing to claim, nothing to post, and no row
    // to strand. A crash here would abort a sibling project's delivery.
    deps.logger.error(
      `delivery tick: project ${lane.projectId} chose finding ${decision.finding.findingId}, which is not in its own candidate list`,
    );
    return "unresolvable";
  }

  // RENDER AND SCAN BEFORE THE CLAIM. Both are pure and cost nothing to redo, so
  // doing them first means a message we will refuse never becomes a `pending`
  // row we then have to unwind.
  const prepared = prepare(chosen, lane, deps.logger);

  // THE CLAIM IS THE LOCK. One statement against the unique index decides who
  // owns this post; there is no "does a delivery already exist?" read before it,
  // so two overlapping ticks cannot both conclude they may post (D4/D6).
  const claim = await deliveries.claimForPost({
    projectId: lane.projectId,
    findingId: chosen.findingId,
    signature: chosen.signature,
    channelId: lane.channelId,
    claimedAt: tickAt,
  });

  if (!claim.claimed) {
    // Someone else owns it — another tick, or a retry of a job that already got
    // as far as posting. Do NOTHING. Posting here is the double-post the
    // deliveries table exists to prevent, and writing a terminal state here
    // would stamp our outcome onto their row.
    deps.logger.info(
      `delivery tick: finding ${chosen.findingId} is already being delivered by another run, so this tick left it alone`,
    );
    return "not_claimed";
  }

  if (!prepared.ok) {
    // We now own a `pending` row for a message we will not send, so the terminal
    // write is mandatory. The row becomes `failed`, which is re-claimable — the
    // finding stays deliverable and a corrected message goes out on a later
    // tick.
    await recordFailed(deps, deliveries, {
      findingId: chosen.findingId,
      channelId: lane.channelId,
      reason: prepared.reason,
    });
    return prepared.outcome;
  }

  let result: PostResult;
  try {
    result = await deps.poster.post(prepared.request);
  } catch (error) {
    // The port is contracted NEVER to throw. If one does anyway, the row still
    // reaches a terminal state — a contract violation must not become a stuck
    // `pending` that jams this project's lane forever.
    //
    // The error's own text NEVER reaches the row: a thrown error can carry
    // vendor detail, ids, and stack text, and `failure_reason` is customer-
    // facing. The log gets the detail (logs are ours); the row gets the
    // one-home sentence.
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
    // The port's `message` is contracted plain English with no vendor text in it
    // (`packages/shared/src/delivery/poster.ts` — an obligation the adapter owns
    // and pins with its own test), so it is recorded as the customer-facing
    // reason: "the channel is gone" is far more actionable than a generic
    // sentence, and this is the one place that distinction survives.
    deps.logger.error(
      `delivery tick: finding ${chosen.findingId} was not accepted by the channel — ${result.code}`,
    );
    await recordFailed(deps, deliveries, {
      findingId: chosen.findingId,
      channelId: lane.channelId,
      reason: result.message,
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
    // THE MESSAGE IS ALREADY IN THE CHANNEL. There is no undo and no retry that
    // would not post it twice, so this is logged loudly and the row is left as
    // it is. This is the one path that can leave a `pending` row behind, and it
    // has to be findable.
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
      // Counted in BOTH: it is a failed delivery, and it is the gate firing.
      summary.failed += 1;
      summary.blockedByPii += 1;
      return;
    case "nothing_today":
      summary.nothingToday += 1;
      return;
    case "not_claimed":
      summary.notClaimed += 1;
      return;
    case "unresolvable":
      summary.lanesErrored += 1;
      return;
  }
}

/**
 * Decide, render, clear, claim, post — once per due project.
 *
 * A tick with no due lanes is a CLEAN NO-OP: no crash, no error state, and
 * nothing recorded. A deployment with no project connected, or no analysis yet
 * run, is a supported deployment (the self-host graceful-absence promise), and
 * recording something here would make "nothing is attached" indistinguishable
 * from "we looked and there was nothing to send" — the one distinction this
 * lane's whole vocabulary exists to keep.
 *
 * The lane READ is deliberately outside the isolation: if the source itself
 * fails there are no lanes to isolate from each other, and letting it throw is
 * what makes Graphile Worker retry the tick rather than record a healthy-looking
 * run over a read that never happened.
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
    lanesErrored: 0,
  };

  if (lanes.length === 0) {
    return summary;
  }

  for (const lane of lanes) {
    try {
      applyOutcome(summary, await runLane(deps, lane, tickAt));
    } catch (error) {
      // PER-LANE ISOLATION (D8). One project's fault cannot cost every other
      // project its delivery — the loop continues, and the next lane posts.
      deps.logger.error(
        `delivery tick: project ${lane.projectId} could not be processed — ${describeError(error)}`,
      );
      summary.lanesErrored += 1;
    }
  }

  deps.logger.info(
    `delivery tick: lanes ${summary.lanesConsidered}, posted ${summary.posted}, failed ${summary.failed} (${summary.blockedByPii} held back), nothing today ${summary.nothingToday}, already claimed ${summary.notClaimed}, errored ${summary.lanesErrored}`,
  );

  return summary;
}
