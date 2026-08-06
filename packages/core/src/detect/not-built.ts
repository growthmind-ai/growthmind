export type NotBuiltDetector = {
  readonly name: string;
  readonly reason: string;
};

export const NOT_BUILT_DETECTORS: readonly NotBuiltDetector[] = [
  {
    name: "rage_click",
    reason:
      "The event-vocabulary route to this remains unbuilt: the probe could not confirm the signal reaches us, and the only available substitute fires on a superset of its target. O-041 does not revive that route — it reads the equivalent moment from session replay, which is a different derivation entirely.",
  },
  {
    name: "dead_click",
    reason:
      "The event-vocabulary route to this remains unbuilt: the probe could not confirm the signal reaches us, and the only available substitute fires on a superset of its target. O-041 derives the equivalent moment from session replay instead, leaving this route exactly as absent as it was.",
  },
  {
    name: "form_abandonment",
    reason:
      "The event-vocabulary route to this remains unbuilt: the probe cannot show the vocabulary supports it honestly, and a substitute built to hit a detector total would be worse than the absence. O-041 observes the equivalent moment in session replay rather than reviving the vocabulary route.",
  },
];
