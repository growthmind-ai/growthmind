import { z } from "zod";

// The signature ledger's reason-code vocabulary (O-006, ADD §5 Wave 1).
// Zod is the single runtime source of truth here; `packages/db`'s
// `text({ enum })` columns are pinned to these unions via
// `as const satisfies` (C-f), so a typo'd column value is a compile error,
// not a silent no-op (D9).
//
// `packages/shared` depends on `zod` ONLY — never `@growthmind/core` (C-b).
// The `SignatureHex` brand and the sha256 hex-digest primitives do NOT live
// here: per ADD D-1 they live in `packages/db/src/signatures/hex.ts`, the
// only package that legally depends on both `@growthmind/core` and
// `@growthmind/shared`. This file holds only the wire-shape enums, which
// have zero node dependency and belong in `packages/shared` per the
// `gate/messages.ts` precedent.

/**
 * Why a signature is (or is not yet) suppressed. Returned by
 * `suppressionDecision` (`packages/core/src/findings/suppression-policy.ts`)
 * on both the `deliver` and `suppress` branches. The v1 branch order (ADD
 * D-2) checks `dismissed` before `already_delivered` — a row that was
 * delivered and then dismissed must report the permanent reason.
 *
 * - `dismissed` — a customer marked this signature "Not useful"; suppressed
 *   permanently, org-wide.
 * - `already_delivered` — this exact signature was already posted; do not
 *   post it again.
 * - `not_seen_before` — the ledger has no row for this signature; deliver.
 * - `seen_not_delivered` — the ledger has a row, but nothing has been
 *   delivered yet; deliver.
 * - `unresolvable_ancestry` — the ancestry forward-walk hit a cycle or the
 *   hop cap; identity could not be resolved, so this suppresses on doubt
 *   (ADD D-2's inverted fail direction: a suppressed real finding surfaces
 *   again later; a duplicate delivered to a founder cannot be un-sent).
 * - `unknown_shape_version` — the candidate's evidence-shape version has no
 *   registered serialiser in this build; suppresses on doubt, same
 *   reasoning as `unresolvable_ancestry`.
 */
export const suppressionReasonCodeSchema = z.enum([
  "dismissed",
  "already_delivered",
  "not_seen_before",
  "seen_not_delivered",
  "unresolvable_ancestry",
  "unknown_shape_version",
]);
export type SuppressionReasonCode = z.infer<typeof suppressionReasonCodeSchema>;

/**
 * The known classes of "churn" that legitimately re-key one of a
 * signature's derived inputs (ADD D-3, D12). Each member is a reason a
 * `signature_ancestry` edge gets written, carrying the old ledger row's
 * state forward (`first_seen_at`, `times_seen`, `delivered_at`,
 * `dismissed_at`) so a dismissal survives the re-key instead of forking.
 */
export const ancestryReasonSchema = z.enum([
  /** The URL-path normaliser's version bumped
   * (`URL_PATH_NORMALISATION_VERSION` in
   * `packages/shared/src/sessions/url-path.ts`) — the same surface now
   * normalises to a different string. */
  "surface_normalisation_version_bump",
  /** `EVIDENCE_SHAPE_VERSION` bumped in
   * `packages/core/src/findings/evidence-shape.ts` — the same underlying
   * evidence now serialises to a different canonical string. */
  "evidence_shape_version_bump",
  /** `SIGNATURE_TUPLE_VERSION` bumped in
   * `packages/core/src/findings/signature-tuple.ts` — the tuple's own
   * serialisation format changed. */
  "signature_tuple_version_bump",
  /** A human- or product-facing rename of the surface itself (e.g. a route
   * moved) with no change to the underlying page or flow it identifies. */
  "surface_rename",
  /** The mechanism that derives `surfaceId` changed (e.g. the M1 swap from
   * a normalised URL path to a ts-morph-derived component identity) — same
   * surface, different derivation. This is the M1 extension point; adding a
   * member here must stay a one-line change. */
  "surface_derivation_swap",
]);
export type AncestryReason = z.infer<typeof ancestryReasonSchema>;

/**
 * The same vocabulary as a non-empty readonly tuple, for drizzle's
 * `text("reason", { enum: ANCESTRY_REASONS })` (C-f: `text({ enum })`,
 * never `pgEnum`). The `satisfies` clause makes the column's value set and
 * the Zod union the same thing by construction — adding a member to one
 * without the other is a compile error, not a silent no-op (D9).
 */
export const ANCESTRY_REASONS = [
  "surface_normalisation_version_bump",
  "evidence_shape_version_bump",
  "signature_tuple_version_bump",
  "surface_rename",
  "surface_derivation_swap",
] as const satisfies readonly [AncestryReason, ...AncestryReason[]];

/**
 * The dismissal action a customer can take on a finding. Exactly one member
 * at MVP: `not_useful`, the permanent org-wide suppression (ADD D-7, D-8).
 * `get_it_fixed` is O-009's and is deliberately NOT added here
 * speculatively — adding it before that sprint owns it would widen this
 * contract surface without a consumer.
 */
export const dismissalActionSchema = z.enum(["not_useful"]);
export type DismissalAction = z.infer<typeof dismissalActionSchema>;

/**
 * The dismissal actions as a non-empty readonly tuple, for drizzle's
 * `text("action", { enum: DISMISSAL_ACTIONS })`. Same construction — and
 * the same guarantee — as `ANCESTRY_REASONS` above.
 */
export const DISMISSAL_ACTIONS = ["not_useful"] as const satisfies readonly [
  DismissalAction,
  ...DismissalAction[],
];

/**
 * The forward-walk hop cap for `signature_ancestry` resolution (ADD D-3(b)).
 * The unique index on `(organization_id, old_signature)` is what makes the
 * walk single-valued and therefore terminating; this cap is belt-and-braces
 * so a pathological chain degrades to a named `depth_cap` unresolvable
 * outcome instead of an unbounded read. 8 hops models one re-key per
 * quarter for two years — a chain longer than that is a bug, not a
 * legitimate history, and should surface as `unresolvable_ancestry` rather
 * than walk forever.
 */
export const ANCESTRY_RESOLUTION_MAX_HOPS = 8;
