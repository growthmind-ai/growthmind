// The finding classes, the detector names, and the shape of a threshold rule set.
//
// Zod enums rather than bare strings so a typo is a compile error and not a runtime one
// (edge taxonomy), the same reason `packages/shared/src/exclusions/types.ts` types
// `ExclusionReason` this way.
import { z } from "zod";

import type { EvidenceSignalKind } from "../evidence/signals";

/**
 * The four classes the three-way split plus the instrumentation class needs. Owners,
 * per architecture: engineering, design/product, growth, and engineering again.
 */
export const findingClassSchema = z.enum([
  "broken",
  "confusing",
  "changed_mind",
  "instrumentation",
]);
export type FindingClass = z.infer<typeof findingClassSchema>;

/**
 * What a T1 detector may propose. `changed_mind` is deliberately not a member, and this
 * is the front door the cascade floor cannot close on its own.
 *
 * `changed_mind`'s proof predicate is "clean exit, no error, no struggle signal".
 * Satisfied by the absence of everything. So a deterministic detector proposing it
 * whenever it sees a clean drop-off would propose it for's undetectable silent
 * save, its proof would be originally present and literally true, the cascade floor
 * would not apply, and the product would tell a founder "this user changed their mind"
 * when the product broke under them. A deterministic detector proposing a class
 * satisfied by absence is "we detected nothing" rendered as "we detected a user
 * decision".
 *
 * That attribution needs a positive behavioural read, which is a model's job and not a
 * predicate's. Consequence, stated plainly: for a clean single-visit drop-off with no
 * struggle signal, this sprint's honest output is nothing at all. That is the correct
 * output.
 */
export const detectorProposedClassSchema = z.enum(["broken", "confusing", "instrumentation"]);
export type DetectorProposedClass = z.infer<typeof detectorProposedClassSchema>;

/**
 * Which detector produced a candidate. An enum, never a free string, because it is an
 * input to `evidence_shape` and therefore to the signature. A free string there is a
 * fork waiting for a typo.
 *
 * Two members, not five: the T1 event-vocabulary probe returned failed-to-pin for the
 * click-event rows, so `rage_click`, `dead_click`, and `form_abandonment`/`thrash` are
 * not built, see `../detect/not-built.ts`.
 */
export const detectorNameSchema = z.enum(["funnel_dropoff", "error_event"]);
export type DetectorName = z.infer<typeof detectorNameSchema>;

/**
 * A versioned threshold rule set. The version travels inside the value, exactly as
 * `ExclusionRuleSet` does, so when v2 lands `THRESHOLD_RULE_SETS.get` still
 * reproduces a v1 decision exactly and a threshold change is a detectable, migratable
 * event rather than a silent fork of every judgement on record.
 *
 * A type alias rather than an interface, deliberately: only a type alias gets
 * TypeScript's implicit index signature, and without it a rule set could not be handed
 * to `canonicalJson`, which the content-hash test requires.
 *
 * Every value is a string, an integer, or an array of those. `canonicalJson` refuses a
 * floating-point value rather than formatting one, so the two rates below are expressed
 * as integer percentages with `Percent` in their names. That also removes float
 * comparison from the inclusive boundary: `numerator * 100 >= threshold * denominator`
 * is exact integer arithmetic, where `numerator / denominator >= 0.4` is not.
 */
export type ThresholdRuleSet = {
  readonly version: number;
  readonly exceptionEventName: string;
  readonly passiveEventNames: readonly string[];
  /**
   * Vendor-namespace prefix. An event carrying it is PostHog's, not the customer's
   * instrumentation, so it may not be named as "the thing the user was trying to do"
   * unless it appears in `userInitiatedVendorEvents`.
   */
  readonly vendorEventPrefix: string;
  /**
   * The vendor events that are a real user action. Small and enumerable, unlike the
   * passive set, which is open-ended and grows with every PostHog release.
   */
  readonly userInitiatedVendorEvents: readonly string[];
  readonly errorCorrelationWindowMs: number;
  readonly errorMinAffectedSessions: number;
  readonly funnelMinSessionsAtOrigin: number;
  readonly funnelMinDropoffSessions: number;
  readonly funnelDropoffRateThresholdPercent: number;
  readonly struggleRepeatedAttemptMin: number;
  readonly struggleMinStrugglingSessions: number;
  readonly instrumentationDropRatioPercent: number;
  readonly instrumentationMinExpected: number;
  readonly brokenProofSignals: readonly EvidenceSignalKind[];
  readonly confusingProofSignals: readonly EvidenceSignalKind[];
  readonly changedMindProofSignals: readonly EvidenceSignalKind[];
  readonly instrumentationProofSignals: readonly EvidenceSignalKind[];
};
