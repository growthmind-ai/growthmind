// Failure mapping at the PostHog boundary (sec-d).
//
// One shared envelope covers auth and throttling (`{type, code, detail, attr}`) so one
// parser serves both, and branching is on `code`, never on the HTTP status alone.
//
// NO 403 branch is coded. Both observed auth failures are 401 (`authentication_failed`
// for an invalid key, `not_authenticated` for a missing header); a 403 was never
// observed, so anything auth-shaped that is not one of the observed codes takes the
// generic path rather than a branch written on a guess.
//
// `detail` is never surfaced verbatim. "Personal API key found in request Authorization
// header is invalid." is exactly the jargon the plain-English bar forbids; it is mapped
// to our own message from @growthmind/shared's messages module.
import type { SourceFailure, SourceFailureCode } from "@growthmind/shared";
import { CONNECT_REFUSAL_MESSAGES } from "@growthmind/shared";
import { z } from "zod";

import { scrubSecrets } from "./scrub";

/**
 * The envelope shape, parsed permissively: `detail` and `attr` are tolerated absent or
 * `null`, because the parser's job is to find `code`, not to certify PostHog's response
 * shape.
 */
export const posthogErrorEnvelopeSchema = z.object({
  type: z.string().optional(),
  code: z.string().optional(),
  detail: z.string().nullish(),
  attr: z.unknown().nullish(),
});
export type PostHogErrorEnvelope = z.infer<typeof posthogErrorEnvelopeSchema>;

/** The envelope codes actually observed against the live API. */
export const POSTHOG_ERROR_CODE = {
  AUTHENTICATION_FAILED: "authentication_failed",
  NOT_AUTHENTICATED: "not_authenticated",
  THROTTLED: "throttled",
} as const;

/**
 * Maps a non-2xx response to a `SourceFailure`.
 *
 * Branching order: the envelope's `code` first, then the status as a fallback for a
 * response that carries no readable envelope at all. `invalid_credentials`,
 * `project_not_found`, and `unreachable` stay distinguishable so the customer is told
 * which of three different things to fix.
 *
 * No key material can appear in the returned message: the message comes from the shared
 * messages module and never from the response body.
 */
/**
 * The customer-facing sentence for each failure class.
 *
 * Every one of the five codes names the same situation `CONNECT_REFUSAL_MESSAGES`
 * already covers, so all five are reused rather than re-authored, one home, no second
 * copy to drift. `connectRefusalCodeSchema` is a superset of `sourceFailureCodeSchema`
 * by construction (see the comment on that schema): validation is a real call to the
 * customer's analytics account, so every way that call can fail (throttling included)
 * is already sayable to them.
 */
const SOURCE_FAILURE_MESSAGES: Record<SourceFailureCode, string> = {
  invalid_credentials: CONNECT_REFUSAL_MESSAGES.invalid_credentials,
  project_not_found: CONNECT_REFUSAL_MESSAGES.project_not_found,
  unreachable: CONNECT_REFUSAL_MESSAGES.unreachable,
  misconfigured: CONNECT_REFUSAL_MESSAGES.misconfigured,
  rate_limited: CONNECT_REFUSAL_MESSAGES.rate_limited,
};

/**
 * Builds the failure with its one plain-English sentence, run through `scrubSecrets`
 * (`./scrub.ts`) before it leaves this function.
 *
 * This is a belt-and-braces pass, the same shape as
 * `packages/db/src/repositories/project-connections.repo.ts`'s
 * `rethrowWithoutParameters`: `SOURCE_FAILURE_MESSAGES` is a fixed, hand-written set of
 * sentences that structurally never contains `secrets` today, exactly like `detail` is
 * parsed above and never interpolated in. The guard exists so that stays true by
 * construction rather than by "nobody has changed this function yet". A later edit that
 * starts folding response content into a message (or the pattern pass alone, for a key
 * PostHog echoes back that this process never held) is caught here rather than shipped.
 */
function failure(code: SourceFailureCode, secrets: readonly string[]): SourceFailure {
  return { code, message: scrubSecrets(SOURCE_FAILURE_MESSAGES[code], secrets) };
}

/**
 * `secrets` are scrubbed out of the returned message even though the message itself
 * never echoes response content. See `failure` above. Callers pass the credential
 * currently in play (`client.ts` passes `config.personalApiKey`) so the guard is live
 * rather than aspirational.
 */
export function mapFailure(
  status: number,
  body: unknown,
  secrets: readonly string[] = [],
): SourceFailure {
  const envelope = posthogErrorEnvelopeSchema.safeParse(body);
  const code = envelope.success ? envelope.data.code : undefined;

  // The envelope's `code` first. Both observed auth failures share status 401 and
  // differ only here, so branching on the status alone could not tell an invalid key
  // from a missing header, and one shared envelope covers throttling too, so one branch
  // serves both.
  switch (code) {
    case POSTHOG_ERROR_CODE.AUTHENTICATION_FAILED:
    case POSTHOG_ERROR_CODE.NOT_AUTHENTICATED:
      return failure("invalid_credentials", secrets);
    case POSTHOG_ERROR_CODE.THROTTLED:
      return failure("rate_limited", secrets);
    default:
      break;
  }

  // Status only as the fallback, for a response carrying no readable envelope at all. A
  // proxy's HTML error page, an empty body, a transport fault. There is deliberately NO
  // 403 branch: a 403 was never observed, so anything auth-shaped that is not one of
  // the codes above takes the generic path rather than a branch written on a guess.
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
