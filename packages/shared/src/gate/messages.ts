type GateReasonClass = "broken" | "confusing" | "changed_mind" | "instrumentation";

export type GateReasonKey = `${GateReasonClass}_satisfied` | `${GateReasonClass}_unsatisfied`;

export const GATE_REASON_MESSAGES: Record<GateReasonKey, string> = {
  broken_satisfied: "We could prove the thing they were trying to do failed on them.",
  broken_unsatisfied:
    "We could not prove that anything actually failed for the people here, so we are not saying it did.",
  confusing_satisfied: "People hesitated, went back, or tried the same thing more than once here.",
  confusing_unsatisfied:
    "We could not show that anyone struggled here, so we are not making a claim about it.",
  changed_mind_satisfied:
    "People left cleanly here, with nothing going wrong and no sign of struggle.",
  changed_mind_unsatisfied:
    "We could not show that people left here with nothing going wrong, so we are not saying they simply moved on.",
  instrumentation_satisfied: "An event you rely on has almost stopped arriving.",
  instrumentation_unsatisfied:
    "We could not show that an event you rely on has stopped arriving as often as it used to.",
};
