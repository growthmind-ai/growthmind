import type { ReplayFailure, ReplayFailureCode } from "@growthmind/shared";
import { REPLAY_FAILURE_MESSAGES } from "@growthmind/shared";
import { z } from "zod";

import { scrubSecrets } from "../http/scrub";

export const rrwebErrorEnvelopeSchema = z.object({
  detail: z.string().nullish(),
  error: z.string().nullish(),
});
export type RrwebErrorEnvelope = z.infer<typeof rrwebErrorEnvelopeSchema>;

const MISSING_SCOPE_PATTERN = /missing scope[:\s]+read:recordingMetadata/i;

// The vendor's own wording is parsed only to classify the failure, then dropped —
// never scrubbed-and-kept, because a leaky upstream can echo a key back encoded.
// Vendor docs disagree on the envelope key (`detail` vs `error`); both are checked.
function namesMissingScope(body: unknown): boolean {
  if (typeof body === "string") {
    return MISSING_SCOPE_PATTERN.test(body);
  }
  const envelope = rrwebErrorEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return false;
  }
  const text = envelope.data.detail ?? envelope.data.error ?? null;
  return typeof text === "string" && MISSING_SCOPE_PATTERN.test(text);
}

export function replayFailure(
  code: ReplayFailureCode,
  secrets: readonly string[] = [],
): ReplayFailure {
  return { code, message: scrubSecrets(REPLAY_FAILURE_MESSAGES[code], secrets) };
}

export function mapRrwebFailure(
  status: number,
  body: unknown,
  context: "validate" | "events",
  secrets: readonly string[] = [],
): ReplayFailure {
  if (status === 401) {
    return namesMissingScope(body)
      ? replayFailure("missing_read_scope", secrets)
      : replayFailure("invalid_credentials", secrets);
  }
  if (status === 403) {
    return replayFailure("invalid_credentials", secrets);
  }
  if (status === 404) {
    return replayFailure(context === "events" ? "recording_not_found" : "misconfigured", secrets);
  }
  if (status === 429) {
    return replayFailure("rate_limited", secrets);
  }
  return replayFailure("unreachable", secrets);
}
