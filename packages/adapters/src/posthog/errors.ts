// Failure mapping at the PostHog boundary (O-003 D-13, SEC-D).
//
// One shared envelope covers auth AND throttling — `{type, code, detail,
// attr}` — so one parser serves both, and branching is on `code`, never on
// the HTTP status alone.
//
// NO 403 BRANCH IS CODED. Both observed auth failures are 401
// (`authentication_failed` for an invalid key, `not_authenticated` for a
// missing header); a 403 was never observed, so anything auth-shaped that is
// not one of the observed codes takes the generic path rather than a branch
// written on a guess.
//
// `detail` IS NEVER SURFACED VERBATIM. "Personal API key found in request
// Authorization header is invalid." is exactly the jargon the plain-English
// bar forbids; it is mapped to our own message from
// @growthmind/shared's messages module.
import type { SourceFailure, SourceFailureCode } from "@growthmind/shared";
import { CONNECT_REFUSAL_MESSAGES } from "@growthmind/shared";
import { z } from "zod";

/**
 * The envelope shape, parsed permissively: `detail` and `attr` are tolerated
 * absent or `null`, because the parser's job is to find `code`, not to
 * certify PostHog's response shape.
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
 * Branching order: the envelope's `code` first, then the status as a
 * fallback for a response that carries no readable envelope at all.
 * `invalid_credentials`, `project_not_found`, and `unreachable` stay
 * distinguishable (FR-9) so the customer is told which of three different
 * things to fix.
 *
 * No key material can appear in the returned message: the message comes from
 * the shared messages module and never from the response body.
 */
/**
 * The customer-facing sentence for each failure class.
 *
 * Every one of the five codes names the SAME situation `CONNECT_REFUSAL_MESSAGES`
 * already covers, so all five are reused rather than re-authored — one home, no
 * second copy to drift (D11 / D-13). `connectRefusalCodeSchema` is a superset of
 * `sourceFailureCodeSchema` by construction (see the comment on that schema):
 * validation is a real call to the customer's analytics account, so every way
 * that call can fail — throttling included — is already sayable to them.
 */
const SOURCE_FAILURE_MESSAGES: Record<SourceFailureCode, string> = {
  invalid_credentials: CONNECT_REFUSAL_MESSAGES.invalid_credentials,
  project_not_found: CONNECT_REFUSAL_MESSAGES.project_not_found,
  unreachable: CONNECT_REFUSAL_MESSAGES.unreachable,
  misconfigured: CONNECT_REFUSAL_MESSAGES.misconfigured,
  rate_limited: CONNECT_REFUSAL_MESSAGES.rate_limited,
};

/** Builds the failure with its one plain-English sentence. Nothing from the
 * response body is ever interpolated in. */
function failure(code: SourceFailureCode): SourceFailure {
  return { code, message: SOURCE_FAILURE_MESSAGES[code] };
}

export function mapFailure(status: number, body: unknown): SourceFailure {
  const envelope = posthogErrorEnvelopeSchema.safeParse(body);
  const code = envelope.success ? envelope.data.code : undefined;

  // The envelope's `code` FIRST. Both observed auth failures share status 401
  // and differ only here, so branching on the status alone could not tell an
  // invalid key from a missing header — and one shared envelope covers
  // throttling too, so one branch serves both.
  switch (code) {
    case POSTHOG_ERROR_CODE.AUTHENTICATION_FAILED:
    case POSTHOG_ERROR_CODE.NOT_AUTHENTICATED:
      return failure("invalid_credentials");
    case POSTHOG_ERROR_CODE.THROTTLED:
      return failure("rate_limited");
    default:
      break;
  }

  // Status only as the fallback, for a response carrying no readable envelope
  // at all — a proxy's HTML error page, an empty body, a transport fault.
  // There is deliberately NO 403 branch: a 403 was never observed, so anything
  // auth-shaped that is not one of the codes above takes the generic path
  // rather than a branch written on a guess.
  if (status === 401) {
    return failure("invalid_credentials");
  }
  if (status === 404) {
    return failure("project_not_found");
  }
  if (status === 429) {
    return failure("rate_limited");
  }
  return failure("unreachable");
}
