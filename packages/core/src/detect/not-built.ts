export type NotBuiltDetector = {
  readonly name: string;
  readonly reason: string;
};

export const NOT_BUILT_DETECTORS: readonly NotBuiltDetector[] = [
  {
    name: "rage_click",
    reason:
      "The event-vocabulary route to this remains unbuilt: the probe could not confirm the signal reaches us, and the only available substitute fires on a superset of its target. Reading the equivalent moment from session replay does not revive that route — it is a different derivation entirely.",
  },
  {
    name: "dead_click",
    reason:
      "The event-vocabulary route to this remains unbuilt: the probe could not confirm the signal reaches us, and the only available substitute fires on a superset of its target. The equivalent moment is derived from session replay instead, leaving this route exactly as absent as it was.",
  },
  {
    name: "form_abandonment",
    reason:
      "The event-vocabulary route to this remains unbuilt: the probe cannot show the vocabulary supports it honestly, and a substitute built to hit a detector total would be worse than the absence. The equivalent moment is observed in session replay instead, rather than by reviving the vocabulary route.",
  },
];
