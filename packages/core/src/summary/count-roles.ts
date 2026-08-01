// Count roles, which number is which, stated in the type system rather than in a
// comment.
//
// The hazard this module exists to remove. `CandidateFinding.counts` is a positional
// array, and the two detectors that fill it neither agree on arity nor state their
// order anywhere a compiler can read:
//
// `../detect/funnel-dropoff.ts:412` emits two counts —
//  `counts: [countOf(atOrigin.length), countOf(dropped.length)]` — whose
//  order is declared only in the prose immediately above it at:408-411:
//  [0] the sessions that reached the origin, [1] the sessions that left it
//  without going anywhere they could have gone;
// `../detect/error-event.ts:308-316` emits one count. The sessions on the
//  surface carrying the exception, over kept sessions.
//
// So `counts[1]` is `undefined` for every error candidate, and nothing at the type
// level says `counts[0]` is the count of sessions that arrived rather than the count of
// sessions that left. Blind indexing therefore yields either nothing or a plausible
// number that means something else, and a number that means something else, read by
// someone deciding what to change about their own product, is the worst output this
// code can produce. Every reader of a candidate's magnitudes goes through this module
// instead.
//
// `MeasuredCount` (`../counts/measured-count.ts:70-77`) carries no label, kind, or role
// of its own. Only `numerator`, `denominator`, `unit`, `timeframe`, `basis`, and its
// brand. That is deliberate there and is why the role has to live here, beside the
// detector arities it describes, rather than on the count.
//
// Pure: no clock, no randomness, no I/O, no node builtin. The package-wide property
// `__tests__/detect/purity.test.ts` asserts over all of `src/`.
//
// Nothing calls this in production. There is no worker task, no persistence, and no
// delivery path in this package; the resolver exists so that the summary rendering
// built beside it cannot index blindly, and no comment here may be read as claiming a
// lane exists.
import type { MeasuredCount } from "../counts/measured-count";
import type { CandidateFinding } from "../findings/candidate";
import type { DetectorName } from "../rules/types";

/**
 * What a count on a candidate means, as a closed union.
 *
 * The names describe the population counted, not the detector that counted it, so a
 * second detector measuring the same thing reuses a role rather than minting a synonym.
 */
export type CountRole = "reached_surface" | "left_without_continuing" | "affected_sessions";

/**
 * The declared roles of each detector's `counts`, in emission order.
 *
 * `satisfies Record<DetectorName, readonly CountRole[]>` is the compile pin: a third
 * detector added to `detectorNameSchema` without a row here fails `bun run typecheck`,
 * and a row naming a role outside the union fails with it. `as const` keeps each row a
 * tuple, which is what lets `ResolvedCounts` below be derived from this table instead
 * of hand-written beside it.
 *
 * Each row's comment cites the emission site it was verified against. Read at that
 * line, not taken from the detector's own prose.
 */
export const COUNT_ROLES = {
  // `../detect/funnel-dropoff.ts:412`, verified at the emission site: `counts:
  // [countOf(atOrigin.length), countOf(dropped.length)]`. `atOrigin` is every kept walk
  // that includes the origin; `dropped` is the subset of those whose walk ends at their
  // first visit to it. Order declared at:408-411.
  funnel_dropoff: ["reached_surface", "left_without_continuing"],
  // `../detect/error-event.ts:308-316`, verified at the emission site: a single
  // `measuredCount({ numerator: group.sessionIds.size,... })`. The one magnitude this
  // detector claims, over kept sessions.
  error_event: ["affected_sessions"],
} as const satisfies Record<DetectorName, readonly CountRole[]>;

/**
 * A candidate's counts, keyed by role instead of by position.
 *
 * Derived from `COUNT_ROLES`, not written beside it, the same "derive the type from the
 * data so a gap is a compile error before it is a test failure" idiom
 * `__tests__/coverage.test.ts:408-423` uses for its own tables. Adding a role to a row
 * above changes this type, and a consumer's exhaustive switch over it fails `bun run
 * typecheck` before any test runs.
 *
 * The result is a discriminated union on `detector`, so a consumer holding a funnel
 * result cannot read `affected_sessions` and a consumer holding an error result cannot
 * read `left_without_continuing`. The two mistakes this module exists to make
 * unwritable.
 */
export type ResolvedCounts = {
  readonly [D in DetectorName]: {
    readonly detector: D;
    readonly counts: { readonly [R in (typeof COUNT_ROLES)[D][number]]: MeasuredCount };
  };
}[DetectorName];

/**
 * Resolves a candidate's positional `counts` into its detector's declared roles.
 *
 * Fail direction: Refuse. A candidate whose `counts` arity disagrees with the arity its
 * detector declares above throws. It does not truncate, it does not pad, and it does
 * not return a partial map.
 *
 * Refusing is the safe direction because every alternative produces a confidently wrong
 * claim rather than an absent one. Truncating drops a magnitude silently; padding
 * invents one; a partial map leaves a consumer substituting `undefined` into a
 * sentence. A summary that never appears is a gap somebody notices and can handle; a
 * summary carrying the arrival count where the departure count belongs is a wrong
 * number nobody can see is wrong. Same direction, and the same reasoning, as the
 * refusals in `../counts/measured-count.ts:192-214`.
 *
 * The message names the detector and both arities, and no count value. An arity is a
 * fact about this codebase and is safe to log; a numerator or a denominator is a fact
 * about somebody else's product, and no such fact belongs in a log line, an error
 * report, or a stack trace.
 *
 * The candidate is taken already typed: `candidateFindingSchema` is the boundary that
 * refuses an unknown detector name, and re-parsing here would be a second boundary that
 * could disagree with the first.
 */
export function resolveCounts(candidate: CandidateFinding): ResolvedCounts {
  const roles: readonly CountRole[] = COUNT_ROLES[candidate.detector];

  if (candidate.counts.length !== roles.length) {
    throw new Error(
      `a ${candidate.detector} candidate must carry one count per declared role: ` +
        `${String(roles.length)} declared, ${String(candidate.counts.length)} received`,
    );
  }

  const byRole: Record<string, MeasuredCount> = {};
  for (const [index, role] of roles.entries()) {
    byRole[role] = candidate.counts[index];
  }

  // Not dead code, and not a re-statement of the arity check above: a row in
  // `COUNT_ROLES` that named the same role twice would pass the arity check and then
  // produce fewer keys than the type promises, silently dropping one of the candidate's
  // magnitudes. This is what makes the narrowing below a checked one rather than a
  // trusted one.
  const missing = roles.filter((role) => !(role in byRole));
  if (missing.length > 0) {
    throw new Error(
      `a ${candidate.detector} candidate resolved no count for ${missing.join(", ")}: ` +
        `its declared roles are not distinct`,
    );
  }

  // The one narrowing in this module. `byRole` is keyed by exactly the roles
  // `COUNT_ROLES[candidate.detector]` declares. Asserted immediately above at runtime,
  // and asserted behaviourally by the named tests in
  // `__tests__/summary/count-roles.test.ts`, which pin each role to the position it
  // resolves from.
  return { detector: candidate.detector, counts: byRole } as ResolvedCounts;
}
