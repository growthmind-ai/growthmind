// The non-bypassable production gate on the credential-encryption key
// (O-003 D-1).
//
// `GROWTHMIND_ALLOW_INSECURE_DEFAULTS=1` exists so the quickstart compose
// stack boots from a clean clone. It must NOT extend to encrypting a third
// party's real secret: BETTER_AUTH_SECRET's blast radius is this deployment's
// own sessions, while this key's blast radius is the customer's PostHog
// account. So the check lives HERE, at the encryption call site, rather than
// at boot — a self-hoster with no PostHog still boots and passes the gate; a
// self-hoster who tries to store a PostHog credential under the published key
// is stopped with an instruction.
//
// TYPED STUB (O-003 scaffold): signatures and the failure vocabulary are
// final; the body throws.
import type { ServerEnv } from "../env";
import type { CredentialKey } from "./secret-box";

export type CredentialKeyFailureReason = "insecure_default_key" | "malformed_key";

export type CredentialKeyResolution =
  | { readonly ok: true; readonly key: CredentialKey }
  | { readonly ok: false; readonly reason: CredentialKeyFailureReason };

/**
 * Resolves `env.GROWTHMIND_ENCRYPTION_KEY` into a usable 32-byte key.
 *
 * Fail directions:
 * - `NODE_ENV === "production"` and the value byte-equals `DEV_ENCRYPTION_KEY`
 *   ⇒ `insecure_default_key`, **regardless of
 *   GROWTHMIND_ALLOW_INSECURE_DEFAULTS**. This is the whole point of the
 *   function.
 * - Not base64, or not exactly `CREDENTIAL_KEY_BYTE_LENGTH` bytes once
 *   decoded ⇒ `malformed_key`.
 *
 * The connection service maps either refusal to a `misconfigured` state whose
 * customer-facing message names the one step that fixes it.
 */
export function resolveCredentialKey(_env: ServerEnv): CredentialKeyResolution {
  throw new Error("TYPED STUB (O-003 scaffold): resolveCredentialKey");
}
