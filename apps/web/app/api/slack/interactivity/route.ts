import { createHash } from "node:crypto";

import {
  createFixesService,
  resolveDeliveryForInteraction,
  type OpenFixResult,
  type ScopedDb,
} from "@growthmind/db";
import {
  FIX_ALREADY_QUEUED_ACKNOWLEDGEMENT,
  FIX_DETAIL_MISSING_REFUSAL,
  FIX_QUEUED_ACKNOWLEDGEMENT,
  logger,
  parseWebEnv,
  SLACK_INTERACTION_UNCONFIGURED_REFUSAL,
  SLACK_TIMESTAMP_TOLERANCE_MS,
  slackInteractionPayloadSchema,
  type SlackInteractionPayload,
} from "@growthmind/shared";

import { getDb } from "@/lib/db";
import { postSlackAcknowledgement } from "@/lib/slack/acknowledge";
import { resolveSlackAction } from "@/lib/slack/interaction-router";
import { verifySlackSignature } from "@/lib/slack/signature";

export const dynamic = "force-dynamic";

const HANDLED_INTERACTIONS_MAX = 512;

// A second belt, not the guard: Slack stamps `x-slack-retry-num` on its own redeliveries and
// that header suppresses the post on any instance. This catches one arriving without it.
const handledInteractions = new Map<string, number>();

function ok(): Response {
  return new Response(null, { status: 200 });
}

function refuseInPlainEnglish(sentence: string): Response {
  return new Response(sentence, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
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

async function mintFor(db: ScopedDb, interaction: SlackInteractionPayload): Promise<string | null> {
  const principal = await resolveDeliveryForInteraction(db, {
    channelId: interaction.container.channel_id ?? interaction.channel.id,
    messageRef: interaction.container.message_ts,
  });

  if (principal === null) {
    logger.warn("slack interactivity: a press arrived on a message this deployment never posted");
    return null;
  }

  const result = await createFixesService(db, principal.context).openFor(principal.findingId);
  return sentenceFor(result);
}

export async function POST(request: Request): Promise<Response> {
  const signingSecret = parseWebEnv(process.env).SLACK_SIGNING_SECRET;
  if (signingSecret === undefined) {
    return refuseInPlainEnglish(SLACK_INTERACTION_UNCONFIGURED_REFUSAL);
  }

  const rawBody = await request.text();

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

  if (resolveSlackAction(interaction.actions[0]?.action_id ?? "").action === "ignore") {
    return ok();
  }

  const nowMs = Date.now();
  const identity = identityOf(payloadText);
  if (alreadyHandled(identity, nowMs)) {
    return ok();
  }

  const sentence = await mintFor(getDb(), interaction);
  rememberHandled(identity, nowMs);

  // A retry means our first answer already spoke into the channel; saying it twice is the
  // duplicate-in-a-shared-channel failure wearing a delivery hat.
  const redelivered = request.headers.get("x-slack-retry-num") !== null;
  if (sentence !== null && !redelivered) {
    await acknowledge(interaction, sentence);
  }

  return ok();
}
