// The finding classes, the detector names, and the shape of a threshold rule
// set (O-004 D-9, D-14).
//
// Zod enums rather than bare strings so a typo is a compile error and not a
// runtime one (edge taxonomy D9) — the same reason
// `packages/shared/src/exclusions/types.ts` types `ExclusionReason` this way.
import { z } from "zod";

import type { EvidenceSignalKind } from "../evidence/signals";

/**
 * The four classes §6's three-way split plus the instrumentation class needs.
 * Owners, per architecture D-3: engineering, design/product, growth, and
 * engineering again.
 */
export const findingClassSchema = z.enum([
  "broken",
  "confusing",
  "changed_mind",
  "instrumentation",
]);
export type FindingClass = z.infer<typeof findingClassSchema>;

/**
 * What a T1 DETECTOR may propose (D-9). `changed_mind` is deliberately NOT a
 * member, and this is the front door FR-13B's cascade floor cannot close on
 * its own.
 *
 * `changed_mind`'s proof predicate is "clean exit, no error, no struggle
 * signal" — satisfied by the ABSENCE of everything. So a deterministic
 * detector proposing it whenever it sees a clean drop-off would propose it for
 * BS-1(a)'s undetectable silent save, its proof would be ORIGINALLY present
 * and literally true, the cascade floor would not apply, and the product would
 * tell a founder "this user changed their mind" when the product broke under
 * them. A deterministic detector proposing a class satisfied by absence is
 * "we detected nothing" rendered as "we detected a user decision".
 *
 * That attribution needs a positive behavioural read, which is a model's job
 * (O-005) and not a predicate's. Consequence, stated plainly: for a clean
 * single-visit drop-off with no struggle signal, this sprint's honest output
 * is NOTHING AT ALL. That is the correct output (ESC-5).
 */
export const detectorProposedClassSchema = z.enum(["broken", "confusing", "instrumentation"]);
export type DetectorProposedClass = z.infer<typeof detectorProposedClassSchema>;

/**
 * Which detector produced a candidate. An enum, never a free string, because
 * it is an input to `evidence_shape` and therefore to O-006's signature — a
 * free string there is a D12 fork waiting for a typo.
 *
 * Two members, not five: the T1 event-vocabulary probe returned FAILED-TO-PIN
 * for the click-event rows, so `rage_click`, `dead_click`, and
 * `form_abandonment`/`thrash` are NOT BUILT — see `../detect/not-built.ts`.
 */
export const detectorNameSchema = z.enum(["funnel_dropoff", "error_event"]);
export type DetectorName = z.infer<typeof detectorNameSchema>;

/**
 * A versioned threshold rule set (D-14, FR-8, FR-11). The version travels
 * INSIDE the value, exactly as `ExclusionRuleSet` does, so when v2 lands
 * `THRESHOLD_RULE_SETS.get(1)` still reproduces a v1 decision exactly and a
 * threshold change is a detectable, migratable event rather than a silent D12
 * fork of every judgement on record.
 *
 * A TYPE ALIAS rather than an interface, deliberately: only a type alias gets
 * TypeScript's implicit index signature, and without it a rule set could not
 * be handed to `canonicalJson` — which FR-11's content-hash test requires.
 *
 * EVERY VALUE IS A STRING, AN INTEGER, OR AN ARRAY OF THOSE. `canonicalJson`
 * refuses a floating-point value rather than formatting one (D-13), so the two
 * rates below are expressed as INTEGER PERCENTAGES with `Percent` in their
 * names. That also removes float comparison from the inclusive boundary
 * (D-6): `numerator * 100 >= threshold * denominator` is exact integer
 * arithmetic, where `numerator / denominator >= 0.4` is not.
 */
export type ThresholdRuleSet = {
  readonly version: number;
  readonly exceptionEventName: string;
  readonly passiveEventNames: readonly string[];
  readonly errorCorrelationWindowMs: number;
  readonly errorMinAffectedSessions: number;
  readonly funnelMinSessionsAtOrigin: number;
  readonly funnelMinDropoffSessions: number;
  readonly funnelDropoffRateThresholdPercent: number;
  readonly struggleRepeatedAttemptMin: number;
  readonly instrumentationDropRatioPercent: number;
  readonly instrumentationMinExpected: number;
  readonly brokenProofSignals: readonly EvidenceSignalKind[];
  readonly confusingProofSignals: readonly EvidenceSignalKind[];
  readonly changedMindProofSignals: readonly EvidenceSignalKind[];
  readonly instrumentationProofSignals: readonly EvidenceSignalKind[];
};
