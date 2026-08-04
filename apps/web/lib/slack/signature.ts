import { createHmac, timingSafeEqual } from "node:crypto";

import { SLACK_TIMESTAMP_TOLERANCE_MS } from "@growthmind/shared";

export const SLACK_SIGNATURE_VERSION = "v0";

export { SLACK_TIMESTAMP_TOLERANCE_MS };

export interface VerifySlackSignatureInput {
  readonly signingSecret: string;
  readonly signature: string | null;
  readonly timestamp: string | null;
  readonly rawBody: string;
  readonly now: Date;
}

export type SlackSignatureRefusalReason = "missing" | "stale" | "mismatch";

export type VerifySlackSignatureResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: SlackSignatureRefusalReason };

const SIGNATURE_PREFIX = `${SLACK_SIGNATURE_VERSION}=`;

const ACCEPTED: VerifySlackSignatureResult = { ok: true };

function refuse(reason: SlackSignatureRefusalReason): VerifySlackSignatureResult {
  return { ok: false, reason };
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");

  if (leftBytes.length !== rightBytes.length) return false;

  return timingSafeEqual(leftBytes, rightBytes);
}

export function verifySlackSignature(input: VerifySlackSignatureInput): VerifySlackSignatureResult {
  const { signature, timestamp } = input;

  if (signature === null || signature.length === 0) return refuse("missing");

  // A signature with no timestamp to bind it to is replayable forever, so it counts as
  // unsigned rather than as a bad signature.
  if (timestamp === null || timestamp.length === 0) return refuse("missing");

  const signedSeconds = Number(timestamp);
  if (!Number.isFinite(signedSeconds)) return refuse("missing");

  const drift = Math.abs(input.now.getTime() - signedSeconds * 1000);
  if (drift > SLACK_TIMESTAMP_TOLERANCE_MS) return refuse("stale");

  if (!signature.startsWith(SIGNATURE_PREFIX)) return refuse("mismatch");

  const expected = createHmac("sha256", input.signingSecret)
    .update(`${SLACK_SIGNATURE_VERSION}:${timestamp}:${input.rawBody}`)
    .digest("hex");

  return constantTimeEquals(signature.slice(SIGNATURE_PREFIX.length), expected)
    ? ACCEPTED
    : refuse("mismatch");
}
