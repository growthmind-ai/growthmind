import { createHash } from "node:crypto";

import { fill } from "@growthmind/core";
import {
  createDismissalsRepo,
  createFixesService,
  createShippedChangeVerdictsRepo,
  createShippedChangesRepo,
  createSignatureLedgerService,
  resolveDeliveryForInteraction,
  resolveNotificationForInteraction,
  type ChooseLeadCountResult,
  type OpenFixResult,
  type RecordVerdictResult,
  type ScopedDb,
} from "@growthmind/db";
import {
  DISMISSAL_ACKNOWLEDGEMENT,
  DISMISSAL_ALREADY_RECORDED_ACKNOWLEDGEMENT,
  FIX_ALREADY_QUEUED_ACKNOWLEDGEMENT,
  FIX_DETAIL_MISSING_REFUSAL,
  FIX_SURFACE_FORBIDDEN_REFUSALS,
  FIX_QUEUED_ACKNOWLEDGEMENT,
  logger,
  parseWebEnv,
  SHIPPED_LEAD_CHANGED_TEMPLATE,
  SHIPPED_LEAD_NAMES,
  SHIPPED_LEAD_TOO_LATE_REFUSAL,
  SHIPPED_VERDICT_RECORDED,
  SHIPPED_VERDICT_TOO_EARLY_REFUSAL,
  SHIPPED_VERDICT_TOO_LATE_REFUSAL,
  SLACK_INTERACTION_UNCONFIGURED_REFUSAL,
  SLACK_TIMESTAMP_TOLERANCE_MS,
  slackInteractionPayloadSchema,
  type ShippedLeadCount,
  type ShippedVerdict,
  type SlackInteractionPayload,
  type TenantContext,
} from "@growthmind/shared";
import { after } from "next/server";

import { getDb } from "@/lib/db";
import { readBoundedBody } from "@/lib/http/bounded-body";
import { postSlackAcknowledgement } from "@/lib/slack/acknowledge";
import { resolveSlackAction, type SlackActionResolution } from "@/lib/slack/interaction-router";
import { verifySlackSignature } from "@/lib/slack/signature";

export const dynamic = "force-dynamic";

const HANDLED_INTERACTIONS_MAX = 512;

// This is the one route no credential guards, so the body is bounded before it is buffered.
// A block_actions payload is a few kilobytes; the ceiling is orders above that and still tiny.
const MAX_BODY_BYTES = 64 * 1024;

const BODY_DECODER = new TextDecoder();

// A second belt, not the guard: Slack stamps `x-slack-retry-num` on its own redeliveries and
// that header suppresses the post on any instance. This catches one arriving without it.
const handledInteractions = new Map<string, number>();

function ok(): Response {
  return new Response(null, { status: 200 });
}

function payloadTextOf(rawBody: string): string {
  return new URLSearchParams(rawBody).get("payload") ?? "";
}

function interactionOf(payloadText: string): SlackInteractionPayload | null {
  let json: unknown;
  try {
    json = JSON.parse(payloadText);
  } catch {
    return null;
  }

  const parsed = slackInteractionPayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// A redelivery repeats the payload byte for byte; a second press cannot, because Slack stamps
// a fresh `response_url`, `trigger_id` and `action_ts` on every press. So the payload is the
// interaction's identity, and "has this finding been opened before" is a different question.
function identityOf(payloadText: string): string {
  return createHash("sha256").update(payloadText).digest("hex");
}

function alreadyHandled(identity: string, nowMs: number): boolean {
  const handledAt = handledInteractions.get(identity);
  return handledAt !== undefined && nowMs - handledAt <= SLACK_TIMESTAMP_TOLERANCE_MS;
}

function rememberHandled(identity: string, nowMs: number): void {
  for (const [seen, at] of handledInteractions) {
    const expired = nowMs - at > SLACK_TIMESTAMP_TOLERANCE_MS;
    if (!expired && handledInteractions.size < HANDLED_INTERACTIONS_MAX) break;
    handledInteractions.delete(seen);
  }
  handledInteractions.set(identity, nowMs);
}

function forgetHandled(identity: string): void {
  handledInteractions.delete(identity);
}

function sentenceFor(result: OpenFixResult): string {
  switch (result.outcome) {
    case "opened":
      return FIX_QUEUED_ACKNOWLEDGEMENT;
    case "already_open":
      return FIX_ALREADY_QUEUED_ACKNOWLEDGEMENT;
    case "finding_not_found":
    case "no_payload":
    case "unrenderable":
      return FIX_DETAIL_MISSING_REFUSAL;
    case "surface_forbidden":
      return FIX_SURFACE_FORBIDDEN_REFUSALS[result.reason];
  }
}

async function acknowledge(interaction: SlackInteractionPayload, text: string): Promise<void> {
  try {
    await postSlackAcknowledgement({ responseUrl: interaction.response_url, text });
  } catch (error) {
    logger.error("slack interactivity: the acknowledgement did not post, the fix is recorded", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function postedAt(interaction: SlackInteractionPayload): {
  readonly channelId: string;
  readonly messageRef: string;
} {
  return {
    channelId: interaction.container.channel_id ?? interaction.channel.id,
    messageRef: interaction.container.message_ts,
  };
}

async function mintFor(db: ScopedDb, interaction: SlackInteractionPayload): Promise<string | null> {
  const principal = await resolveDeliveryForInteraction(db, postedAt(interaction));

  if (principal === null) {
    logger.warn("slack interactivity: a press arrived on a message this deployment never posted");
    return null;
  }

  const result = await createFixesService(db, principal.context).openFor(principal.findingId);

  logger.info("slack interactivity: a press was served", {
    slackUserId: interaction.user?.id ?? null,
    findingId: principal.findingId,
    outcome: result.outcome,
  });

  return sentenceFor(result);
}

// The read is purely for copy selection (which sentence to say); the write below is
// unconditional and idempotent either way, so a race between the read and a concurrent
// press changes only which acknowledgement sentence is said, never how many dismissal
// rows or ledger stamps result (ADD "Slack dismiss handler" implementation note).
async function dismissFor(
  db: ScopedDb,
  interaction: SlackInteractionPayload,
): Promise<string | null> {
  const principal = await resolveDeliveryForInteraction(db, postedAt(interaction));

  if (principal === null) {
    logger.warn("slack interactivity: a press arrived on a message this deployment never posted");
    return null;
  }

  const existing = await createDismissalsRepo(db, principal.context).findFor(
    principal.findingId,
    "not_useful",
  );

  // No Slack-user-to-org-member identity mapping exists (ADD's cross-cutting decision) —
  // the same system-actor footing `openFor` already stands on for "Get it fixed".
  await createSignatureLedgerService(db, principal.context).recordDismissal({
    projectId: principal.projectId,
    findingId: principal.findingId,
    signature: principal.signature,
    action: "not_useful",
    dismissedByUserId: null,
  });

  logger.info("slack interactivity: a dismissal press was served", {
    findingId: principal.findingId,
    alreadyRecorded: existing !== null,
  });

  return existing !== null ? DISMISSAL_ALREADY_RECORDED_ACKNOWLEDGEMENT : DISMISSAL_ACKNOWLEDGEMENT;
}

interface ShippedSubject {
  readonly context: TenantContext;
  readonly changeId: string;
}

// The organization comes from the (channel, message) pair and from nowhere else, so nothing the
// payload says about a workspace or a person reaches the context. The button's value is then
// checked against what that pair resolved to, which turns a crafted press into a refusal.
async function shippedSubjectOf(
  db: ScopedDb,
  interaction: SlackInteractionPayload,
): Promise<ShippedSubject | null> {
  const principal = await resolveNotificationForInteraction(db, postedAt(interaction));

  if (principal === null) {
    logger.warn("slack interactivity: a press arrived on a message this deployment never posted");
    return null;
  }

  if (principal.subjectKind !== "shipped_change") {
    logger.warn("slack interactivity: a shipped-change press landed on some other kind of post", {
      subjectKind: principal.subjectKind,
    });
    return null;
  }

  if (interaction.actions[0]?.value !== principal.subjectId) {
    logger.warn("slack interactivity: a press named something the message it sits on does not");
    return null;
  }

  return { context: principal.context, changeId: principal.subjectId };
}

function verdictSentenceFor(kind: RecordVerdictResult["kind"]): string {
  switch (kind) {
    case "recorded":
      return SHIPPED_VERDICT_RECORDED;
    case "already_recorded":
      return SHIPPED_VERDICT_TOO_LATE_REFUSAL;
    case "not_read_out":
      return SHIPPED_VERDICT_TOO_EARLY_REFUSAL;
  }
}

async function recordVerdictFor(
  db: ScopedDb,
  interaction: SlackInteractionPayload,
  verdict: ShippedVerdict,
): Promise<string | null> {
  const subject = await shippedSubjectOf(db, interaction);
  if (subject === null) {
    return null;
  }

  const result = await createShippedChangeVerdictsRepo(db, subject.context).recordVerdict({
    changeId: subject.changeId,
    verdict,
    recordedAt: new Date(),
    recordedBySlackUserId: interaction.user?.id ?? null,
  });

  logger.info("slack interactivity: a verdict press was served", { outcome: result.kind });

  return verdictSentenceFor(result.kind);
}

function leadSentenceFor(kind: ChooseLeadCountResult["kind"], leadCount: ShippedLeadCount): string {
  return kind === "chosen"
    ? fill(SHIPPED_LEAD_CHANGED_TEMPLATE, { lead: SHIPPED_LEAD_NAMES[leadCount] })
    : SHIPPED_LEAD_TOO_LATE_REFUSAL;
}

async function chooseLeadFor(
  db: ScopedDb,
  interaction: SlackInteractionPayload,
  leadCount: ShippedLeadCount,
): Promise<string | null> {
  const subject = await shippedSubjectOf(db, interaction);
  if (subject === null) {
    return null;
  }

  const result = await createShippedChangesRepo(db, subject.context).chooseLeadCount({
    changeId: subject.changeId,
    leadCount,
  });

  logger.info("slack interactivity: a lead-count press was served", { outcome: result.kind });

  return leadSentenceFor(result.kind, leadCount);
}

type ServedAction = Exclude<SlackActionResolution, { readonly action: "ignore" }>;

interface PressWork {
  readonly interaction: SlackInteractionPayload;
  readonly identity: string;
  readonly redelivered: boolean;
  readonly action: ServedAction;
}

function answerTo(work: PressWork): Promise<string | null> {
  const db = getDb();

  switch (work.action.action) {
    case "open_fix":
      return mintFor(db, work.interaction);
    case "dismiss":
      return dismissFor(db, work.interaction);
    case "verdict":
      return recordVerdictFor(db, work.interaction, work.action.verdict);
    case "lead_count":
      return chooseLeadFor(db, work.interaction, work.action.leadCount);
  }
}

async function servePress(work: PressWork): Promise<void> {
  let sentence: string | null;

  try {
    sentence = await answerTo(work);
  } catch (error) {
    // Releasing the claim leaves Slack's redelivery of the same payload free to try again.
    forgetHandled(work.identity);
    logger.error("slack interactivity: a press reached nothing, so nothing was recorded", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (sentence !== null && !work.redelivered) {
    await acknowledge(work.interaction, sentence);
  }
}

// Slack gives an interactivity request three seconds before it calls the press timed out and
// redelivers it, and minting a fix reads and writes several rows. `after` throws when there is
// no request scope around it — a direct call rather than a served request — and running the
// work inline there is the ordering that preceded this, not a dropped effect.
async function afterResponse(work: () => Promise<void>): Promise<void> {
  try {
    after(work);
  } catch {
    await work();
  }
}

export async function POST(request: Request): Promise<Response> {
  const signingSecret = parseWebEnv(process.env).SLACK_SIGNING_SECRET;
  if (signingSecret === undefined) {
    // An empty 200 is the only body Slack documents for an interactivity request: it
    // shows the presser nothing. What Slack does with a non-empty one is undocumented,
    // and its nearest documented sibling renders the body as a message — which on this
    // response would replace the finding card the button is attached to.
    logger.error(SLACK_INTERACTION_UNCONFIGURED_REFUSAL);
    return new Response(null, { status: 200 });
  }

  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return new Response(null, { status: 413 });
  }

  const rawBody = BODY_DECODER.decode(body.bytes);

  const verified = verifySlackSignature({
    signingSecret,
    signature: request.headers.get("x-slack-signature"),
    timestamp: request.headers.get("x-slack-request-timestamp"),
    rawBody,
    now: new Date(),
  });
  if (!verified.ok) {
    return new Response(null, { status: 401 });
  }

  const payloadText = payloadTextOf(rawBody);

  const interaction = interactionOf(payloadText);
  if (interaction === null) {
    return new Response(null, { status: 400 });
  }

  const actionId = interaction.actions[0]?.action_id ?? "";
  const resolution = resolveSlackAction(actionId);
  if (resolution.action === "ignore") {
    logger.info("slack interactivity: a press named an action this deployment does not serve", {
      actionId,
    });
    return ok();
  }

  const nowMs = Date.now();
  const identity = identityOf(payloadText);
  if (alreadyHandled(identity, nowMs)) {
    return ok();
  }
  rememberHandled(identity, nowMs);

  // A retry means our first answer already spoke into the channel; saying it twice is the
  // duplicate-in-a-shared-channel failure wearing a delivery hat.
  const redelivered = request.headers.get("x-slack-retry-num") !== null;

  await afterResponse(() => servePress({ interaction, identity, redelivered, action: resolution }));

  return ok();
}
