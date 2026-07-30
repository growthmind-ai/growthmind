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
import type { SourceFailure } from "@growthmind/shared";
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
export function mapFailure(_status: number, _body: unknown): SourceFailure {
  throw new Error("TYPED STUB (O-003 scaffold): mapFailure");
}
