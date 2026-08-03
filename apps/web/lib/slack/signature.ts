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

const NOT_IMPLEMENTED = "slack signature: verifySlackSignature is not implemented";

export function verifySlackSignature(input: VerifySlackSignatureInput): VerifySlackSignatureResult {
  void input;
  throw new Error(NOT_IMPLEMENTED);
}
