export type NotBuiltDetector = {
  readonly name: string;
  readonly reason: string;
};

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
