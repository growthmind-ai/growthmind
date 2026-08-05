import type { SourceFailure, SourceFailureCode } from "@growthmind/shared";
import { CONNECT_REFUSAL_MESSAGES } from "@growthmind/shared";
import { z } from "zod";

import { scrubSecrets } from "../http/scrub";

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

// Exported because `discovery.ts` refuses a blocked host and an empty project list itself,
// and both owe the customer the same sentence and the same scrub pass. `secrets` is the
// credential in play (`client.ts` passes `config.personalApiKey`), so the guard is live.
// These sentences never interpolate response content: the vendor's own `detail` is parsed
// then DROPPED rather than scrubbed, because a leaky upstream can echo a key back
// URL-encoded or JSON-escaped — forms an exact-string scrub misses.
export function sourceFailure(code: SourceFailureCode, secrets: readonly string[]): SourceFailure {
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
      return sourceFailure("invalid_credentials", secrets);
    case POSTHOG_ERROR_CODE.THROTTLED:
      return sourceFailure("rate_limited", secrets);
    default:
      break;
  }

  if (status === 401) {
    return sourceFailure("invalid_credentials", secrets);
  }
  if (status === 404) {
    return sourceFailure("project_not_found", secrets);
  }
  if (status === 429) {
    return sourceFailure("rate_limited", secrets);
  }
  return sourceFailure("unreachable", secrets);
}
