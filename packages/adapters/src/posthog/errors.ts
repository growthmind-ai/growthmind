import type { SourceFailure, SourceFailureCode } from "@growthmind/shared";
import { CONNECT_REFUSAL_MESSAGES } from "@growthmind/shared";
import { z } from "zod";

import { scrubSecrets } from "./scrub";

export const posthogErrorEnvelopeSchema = z.object({
  type: z.string().optional(),
  code: z.string().optional(),
  detail: z.string().nullish(),
  attr: z.unknown().nullish(),
});
export type PostHogErrorEnvelope = z.infer<typeof posthogErrorEnvelopeSchema>;

export const POSTHOG_ERROR_CODE = {
  AUTHENTICATION_FAILED: "authentication_failed",
  NOT_AUTHENTICATED: "not_authenticated",
  THROTTLED: "throttled",
} as const;

const SOURCE_FAILURE_MESSAGES: Record<SourceFailureCode, string> = {
  invalid_credentials: CONNECT_REFUSAL_MESSAGES.invalid_credentials,
  project_not_found: CONNECT_REFUSAL_MESSAGES.project_not_found,
  unreachable: CONNECT_REFUSAL_MESSAGES.unreachable,
  misconfigured: CONNECT_REFUSAL_MESSAGES.misconfigured,
  rate_limited: CONNECT_REFUSAL_MESSAGES.rate_limited,
};

function failure(code: SourceFailureCode, secrets: readonly string[]): SourceFailure {
  return { code, message: scrubSecrets(SOURCE_FAILURE_MESSAGES[code], secrets) };
}

export function mapFailure(
  status: number,
  body: unknown,
  secrets: readonly string[] = [],
): SourceFailure {
  const envelope = posthogErrorEnvelopeSchema.safeParse(body);
  const code = envelope.success ? envelope.data.code : undefined;

  switch (code) {
    case POSTHOG_ERROR_CODE.AUTHENTICATION_FAILED:
    case POSTHOG_ERROR_CODE.NOT_AUTHENTICATED:
      return failure("invalid_credentials", secrets);
    case POSTHOG_ERROR_CODE.THROTTLED:
      return failure("rate_limited", secrets);
    default:
      break;
  }

  if (status === 401) {
    return failure("invalid_credentials", secrets);
  }
  if (status === 404) {
    return failure("project_not_found", secrets);
  }
  if (status === 429) {
    return failure("rate_limited", secrets);
  }
  return failure("unreachable", secrets);
}
