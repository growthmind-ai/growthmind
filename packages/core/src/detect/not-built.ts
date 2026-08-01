// The detectors this sprint deliberately does not build.
//
// This file follows the F-9 precedent at
// `packages/shared/src/exclusions/classify.ts:69-78`: a deliberate non-implementation
// is stated out loud at the place a reader looks for it, with its reason, and enforced
// by a grep test, never silently omitted, and never inferred from an empty directory.
//
// Why they are not built
//
// The T1 event-vocabulary probe ran against the configured analytics project before
// this sprint committed to any detector shape. It returned failed-to-pin for every
// click-event row: the project's entire history is 220 synthetic events written by this
// repo's own spikes, with zero browser-originated events in it. Zero observations of a
// browser event in a corpus containing zero browser traffic measures our own writes,
// not the vendor's client configuration, so the honest verdict is inconclusive, and a
// detector is never built on an assumption.
//
// Why the obvious fallback is worse than the absence
//
// The tempting substitute is to infer rage from rapid repeated clicks on one path,
// grouped by time. That must not be built. Without the element chain, which the adapter
// reads on the wire and deliberately never parses, and reaching for it is an adapter
// change this sprint does not take. You cannot prove two clicks hit the same element,
// and rapid clicking across different elements is fast navigation, not rage. Such a
// predicate fires on a superset of its real target by construction: the textbook
// conflation this sprint exists to prevent, and the exact reasoning that kept the F-9
// host-based staging predicate out of the exclusion classifier.
//
// It would also be worse than silence downstream. A proxy built to hit a detector count
// feeds the evidence gate false struggle proof, and the gate would correctly pass it,
// so the fabrication would arrive at a founder wearing the gate's own credibility. "No
// verdict beats a wrong verdict."
//
// What lifts this later
//
// One thing: point a real browser SDK at a project (or supply a customer project's read
// credentials) and re-run `scripts/spikes/t1-event-vocabulary-probe.ts`. The probe
// exists to be re-runnable precisely so these rows can be lifted without rebuilding an
// instrument. Carried as in the add, not only here.

/** One detector named by the outcome and deliberately not built, with the reason a
 * reader needs before they consider adding it. */
export type NotBuiltDetector = {
  readonly name: string;
  readonly reason: string;
};

/**
 * The documented absences. Exported so a test can assert this list is non-empty and
 * matches the add, rather than an empty directory being read as "nobody got round to
 * it".
 *
 * Every reason below is deliberately free of vendor event-name literals: the guard test
 * scans this directory's executable code for them, and the explanation belongs in the
 * comment block above, where it cannot be mistaken for a rule the code applies.
 */
export const NOT_BUILT_DETECTORS: readonly NotBuiltDetector[] = [
  {
    name: "rage_click",
    reason:
      "The event-vocabulary probe could not confirm this signal reaches us, and the only available substitute fires on a superset of its target.",
  },
  {
    name: "dead_click",
    reason:
      "The event-vocabulary probe could not confirm this signal reaches us, and the only available substitute fires on a superset of its target.",
  },
  {
    name: "form_abandonment",
    reason:
      "The probe cannot show the vocabulary supports this honestly, and a substitute built to hit a detector total would be worse than the absence.",
  },
];
