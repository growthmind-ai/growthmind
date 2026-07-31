// `SignatureHex` — the branded 64-char lowercase hex digest identity for the
// finding-signature ledger (O-006 ADD §2 D-1, §5 Wave 3).
//
// This is the ONLY module in the codebase that computes a real sha256 digest
// for finding identity. `packages/core` produces the pure, versioned tuple
// STRING (`signatureTuple`); this file hashes it. It lives in `packages/db`,
// not `packages/shared`, because `packages/db` is the only package that
// legally depends on both `@growthmind/core` and `@growthmind/shared`
// (W0-4, W0-3) — the one place a single file can both call `node:crypto` and
// consume a `CandidateFinding`-shaped input in one step. See ADD D-1 for the
// full rejection of the earlier three-package draft: don't "simplify" this
// back into `packages/shared` — there is no coupling to avoid, because both
// of O-007's future homes (`apps/web`, `worker`) already depend on
// `packages/db` today, for reasons that have nothing to do with this sprint.
//
// THIS IS AN IDENTITY DIGEST OVER NON-SECRET STRUCTURED VALUES. It is NOT an
// HMAC and must not be described as one — there is no root key, so there is
// no rotation, so nothing about a rotation forks an identity here (contrast
// `packages/shared/src/sessions/identity-key.ts`, which keys a real HMAC and
// therefore does have a rotation-consequence comment).
import { createHash } from "node:crypto";

/** A valid `SignatureHex` is exactly this many characters. */
export const SIGNATURE_HEX_LENGTH = 64;

/** Lowercase hex only. Uppercase is REFUSED, never normalised — silently
 * lowercasing an uppercase digest would let two callers who hashed the same
 * bytes differently (case-wise) collide on a value neither of them wrote. */
export const SIGNATURE_HEX_FORMAT = /^[0-9a-f]{64}$/;

/** Display-only prefix length (P1, FR-P1-2). At 4 hex characters the
 * collision probability across one project's ledger is ~1 in 65,536 —
 * acceptable because a prefix is NEVER used as a lookup key, only as a
 * human-scannable label next to the full signature. */
export const SIGNATURE_DISPLAY_PREFIX_LENGTH = 4;

/**
 * Module-private brand key (`measured-count.ts`'s `unique symbol` pattern,
 * relocated here per ADD D-1). Deliberately NOT exported: the only code that
 * can produce a value carrying this brand is `signatureHex`/`sha256Hex`
 * below, in this file.
 */
declare const signatureHexBrand: unique symbol;

/**
 * A 64-char lowercase hex sha256 digest, and nothing else. A structurally
 * identical plain `string` is NOT a `SignatureHex` — only this module's two
 * constructors (`signatureHex`, `sha256Hex`) can produce one.
 */
export type SignatureHex = string & { readonly [signatureHexBrand]: true };

/**
 * True only for a value carrying this module's brand — in practice, true
 * only for a value structurally matching `SIGNATURE_HEX_FORMAT`, since that
 * regex is the sole gate every constructor in this file runs a value through
 * before casting. Never throws.
 */
export function isSignatureHex(value: string): value is SignatureHex {
  return SIGNATURE_HEX_FORMAT.test(value);
}

/**
 * The only validating constructor that casts an arbitrary string to
 * `SignatureHex`. Refuses uppercase hex, the wrong length, a non-hex
 * character, and the empty string.
 *
 * The refusal message MUST NEVER echo the offending value
 * (`evidence-shape.ts:99-102`'s rule, restated here): echoing it is how a
 * caller's raw input — which might not even be hex-shaped, e.g. a stray
 * token or an email address — gets copied into a log line. The message
 * names the EXPECTED format only.
 */
export function signatureHex(value: string): SignatureHex {
  if (!isSignatureHex(value)) {
    throw new Error(
      `invalid signature: expected exactly ${String(SIGNATURE_HEX_LENGTH)} lowercase hex characters (0-9a-f)`,
    );
  }

  return value;
}

/**
 * `createHash("sha256").update(material).digest("hex")`, cast to the brand
 * HERE AND NOWHERE ELSE (`write-keys/material.ts:19-25`'s one-liner is the
 * mechanism this copies, not its package).
 *
 * `material` is an OPAQUE string — this function never inspects it and never
 * re-derives it. The caller (`computeFindingSignature`,
 * `packages/db/src/services/signature-ledger.service.ts`) owns composing it
 * from `signatureTuple`'s output, and is the ONLY caller of this function in
 * production code (ADD D-1, D11).
 *
 * Node's `sha256` + `"hex"` digest encoding is unconditionally 64 lowercase
 * hex characters, so the cast below is safe without re-running it through
 * `signatureHex`'s refusal path.
 */
export function sha256Hex(material: string): SignatureHex {
  const digest = createHash("sha256").update(material).digest("hex");

  return digest as SignatureHex;
}

/**
 * Display-only prefix (P1, FR-P1-2). NEVER a valid `SignatureHex` on its own
 * — it is shorter than `SIGNATURE_HEX_LENGTH` — and must never be accepted
 * as a lookup input; a test in the next wave asserts exactly that
 * (`isSignatureHex` must reject a prefix-length string).
 */
export function signatureDisplayPrefix(signature: SignatureHex): string {
  return signature.slice(0, SIGNATURE_DISPLAY_PREFIX_LENGTH);
}
